"use client";

/**
 * Owns the live Deepgram session for the entire app.
 *
 * Why this exists: previously the recorder was mounted inside Copilot (full)
 * and CompactCopilot (compact). Toggling between those two surfaces unmounted
 * the recorder, which tore down the WebSocket and media stream. This
 * provider lifts the session above the surface boundary so flipping
 * compact ↔ full no longer interrupts an active recording.
 *
 * Both surfaces consume the same `transcribedText` / `transcriptionSegments`
 * and call the same `startSession` / `stopSession` actions, so a recording
 * started from the compact toolbar can be observed and stopped from the
 * full Copilot view (and vice-versa).
 */

import posthog from "posthog-js";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useClientReady } from "@/hooks/useClientReady";
import {
  type DeepgramSessionHandle,
  type SessionState,
  startDeepgramSession,
} from "@/lib/transcription/deepgramSession";
import { mergeSegments } from "@/lib/transcription/segmentMerger";
import { endLiveSession, trackEvent } from "@/lib/session-tracking";
import type { TranscriptionSegment } from "@/lib/types";

export type { SessionState } from "@/lib/transcription/deepgramSession";

interface TranscriptionContextValue {
  transcribedText: string;
  transcriptionSegments: TranscriptionSegment[];
  sessionState: SessionState;
  errorMessage: string | null;
  isElectron: boolean | null;
  isClientReady: boolean;
  isActive: boolean;
  isBusy: boolean;
  isReconnecting: boolean;
  startSession: () => Promise<void>;
  stopSession: () => void;
  clearTranscription: () => void;
  dismissError: () => void;
}

const TranscriptionContext = createContext<TranscriptionContextValue | null>(
  null,
);

export function TranscriptionProvider({ children }: { children: ReactNode }) {
  const isClientReady = useClientReady();

  const [isElectron, setIsElectron] = useState<boolean | null>(null);
  const [sessionState, setSessionState] = useState<SessionState>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [transcribedText, setTranscribedText] = useState<string>("");
  const [transcriptionSegments, setTranscriptionSegments] = useState<
    TranscriptionSegment[]
  >([]);

  const sessionHandleRef = useRef<DeepgramSessionHandle | null>(null);
  const segmentCounterRef = useRef<number>(0);
  // Each call to startSession bumps this. Any async work (key fetch, ws
  // open, etc.) checks `isStale()` to bail out if a newer session has
  // started in the meantime. Without this, double-clicking Start could
  // leave two parallel sessions running.
  const sessionIdRef = useRef<number>(0);

  useEffect(() => {
    setIsElectron(typeof window !== "undefined" && !!window.electronAPI);
  }, []);

  const stopHandle = useCallback(() => {
    if (sessionHandleRef.current) {
      sessionHandleRef.current.stop();
      sessionHandleRef.current = null;
    }
  }, []);

  const startSession = useCallback(async () => {
    stopHandle();
    const thisSession = ++sessionIdRef.current;
    setErrorMessage(null);

    const handle = await startDeepgramSession({
      isElectron: !!isElectron,
      nextSegmentId: () => `segment-${segmentCounterRef.current++}`,
      onState: (s) => {
        // Ignore state updates from an older session that was stopped
        // before its async startup finished.
        if (sessionIdRef.current !== thisSession) return;
        setSessionState(s);
      },
      onError: (msg) => {
        if (sessionIdRef.current !== thisSession) return;
        setErrorMessage(msg);
      },
      onTranscribedText: (updater) => {
        if (sessionIdRef.current !== thisSession) return;
        setTranscribedText(updater);
      },
      onSegment: (segment) => {
        if (sessionIdRef.current !== thisSession) return;
        setTranscriptionSegments((prev) => mergeSegments(prev, segment));
      },
    });

    if (sessionIdRef.current !== thisSession) {
      handle.stop();
      return;
    }
    sessionHandleRef.current = handle;
  }, [isElectron, stopHandle]);

  const stopSession = useCallback(() => {
    sessionIdRef.current++;
    const sid = sessionHandleRef.current?.getLiveSessionId() ?? null;
    stopHandle();
    setSessionState("idle");
    posthog.capture("recording_stopped", {
      platform: isElectron ? "electron" : "browser",
    });
    trackEvent("recording_stop", {
      sessionId: sid,
      metadata: { platform: isElectron ? "electron" : "browser" },
    });
    if (sid) void endLiveSession(sid, "user_stopped");
  }, [stopHandle, isElectron]);

  const clearTranscription = useCallback(() => {
    setTranscribedText("");
    setTranscriptionSegments([]);
  }, []);

  const dismissError = useCallback(() => setErrorMessage(null), []);

  // Tear down for real when the provider itself unmounts (i.e. app close /
  // hard navigation). Toggling compact ↔ full no longer remounts the
  // provider, so this only fires on real teardown.
  useEffect(() => {
    return () => {
      sessionIdRef.current++;
      const sid = sessionHandleRef.current?.getLiveSessionId() ?? null;
      stopHandle();
      if (sid) void endLiveSession(sid, "client_unmount");
    };
  }, [stopHandle]);

  const isActive = sessionState !== "idle";
  const isReconnecting = sessionState === "reconnecting";
  const isBusy =
    sessionState === "fetching-key" ||
    sessionState === "connecting" ||
    isReconnecting;

  // Memoize so consumers don't re-render on unrelated parent re-renders.
  // Every callback in the value is already wrapped in useCallback, so
  // identity is stable as long as state and isElectron don't change.
  const value = useMemo<TranscriptionContextValue>(
    () => ({
      transcribedText,
      transcriptionSegments,
      sessionState,
      errorMessage,
      isElectron,
      isClientReady,
      isActive,
      isBusy,
      isReconnecting,
      startSession,
      stopSession,
      clearTranscription,
      dismissError,
    }),
    [
      transcribedText,
      transcriptionSegments,
      sessionState,
      errorMessage,
      isElectron,
      isClientReady,
      isActive,
      isBusy,
      isReconnecting,
      startSession,
      stopSession,
      clearTranscription,
      dismissError,
    ],
  );

  return (
    <TranscriptionContext.Provider value={value}>
      {children}
    </TranscriptionContext.Provider>
  );
}

export function useTranscription(): TranscriptionContextValue {
  const ctx = useContext(TranscriptionContext);
  if (!ctx) {
    throw new Error(
      "useTranscription must be used within a TranscriptionProvider",
    );
  }
  return ctx;
}
