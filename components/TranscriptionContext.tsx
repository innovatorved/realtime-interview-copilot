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

import {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  CreateProjectKeyResponse,
  LiveClient,
  LiveTranscriptionEvents,
  createClient,
} from "@deepgram/sdk";
import posthog from "posthog-js";
import { TranscriptionSegment, TranscriptionWord } from "@/lib/types";
import { BACKEND_API_URL } from "@/lib/constant";
import { useClientReady } from "@/hooks/useClientReady";
import {
  endLiveSession,
  startLiveSession,
  trackEvent,
} from "@/lib/session-tracking";

export type SessionState = "idle" | "fetching-key" | "connecting" | "live";

interface TranscriptionContextValue {
  transcribedText: string;
  transcriptionSegments: TranscriptionSegment[];
  sessionState: SessionState;
  errorMessage: string | null;
  isElectron: boolean | null;
  isClientReady: boolean;
  isActive: boolean;
  isBusy: boolean;
  startSession: () => Promise<void>;
  stopSession: () => void;
  clearTranscription: () => void;
  dismissError: () => void;
}

const TranscriptionContext = createContext<TranscriptionContextValue | null>(
  null,
);

interface DeepgramWord {
  word: string;
  punctuated_word?: string;
  start?: number;
  end?: number;
  confidence?: number;
}

export function TranscriptionProvider({ children }: { children: ReactNode }) {
  const isClientReady = useClientReady();

  const [isElectron, setIsElectron] = useState<boolean | null>(null);
  const [sessionState, setSessionState] = useState<SessionState>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [transcribedText, setTranscribedText] = useState<string>("");
  const [transcriptionSegments, setTranscriptionSegments] = useState<
    TranscriptionSegment[]
  >([]);

  const connectionRef = useRef<LiveClient | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const segmentCounterRef = useRef<number>(0);
  // Each call to startSession bumps this. Any async work (key fetch, ws
  // open, etc.) checks `isStale()` to bail out if a newer session has
  // started in the meantime. Without this, double-clicking Start could
  // leave two parallel sessions running.
  const sessionIdRef = useRef<number>(0);
  const liveSessionIdRef = useRef<string | null>(null);
  // Mirror of sessionState available in callbacks without re-binding.
  const sessionStateRef = useRef<SessionState>("idle");
  sessionStateRef.current = sessionState;

  useEffect(() => {
    setIsElectron(typeof window !== "undefined" && !!window.electronAPI);
  }, []);

  const teardown = useCallback(() => {
    if (mediaRecorderRef.current) {
      try {
        mediaRecorderRef.current.stop();
      } catch {
        /* already stopped */
      }
      mediaRecorderRef.current = null;
    }

    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((track) => track.stop());
      mediaStreamRef.current = null;
    }

    if (connectionRef.current) {
      try {
        connectionRef.current.finish();
      } catch {
        /* already closed */
      }
      connectionRef.current = null;
    }

    setSessionState("idle");
  }, []);

  const startSession = useCallback(async () => {
    teardown();

    const thisSession = ++sessionIdRef.current;
    const isStale = () => sessionIdRef.current !== thisSession;

    setSessionState("fetching-key");
    setErrorMessage(null);

    let media: MediaStream;
    try {
      // getDisplayMedia requires a video track; in Electron our main-process
      // handler (setDisplayMediaRequestHandler) auto-selects the primary
      // screen and pairs it with system-audio loopback, so no picker
      // appears. In the browser build, the user picks a tab/window and
      // enables "Share audio" to grant system/tab audio.
      media = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: true,
      });

      media.getVideoTracks().forEach((track) => track.stop());

      if (media.getAudioTracks().length === 0) {
        media.getTracks().forEach((t) => t.stop());
        throw new Error("No system audio track available");
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      const hint = isElectron
        ? "Grant Screen Recording permission in System Settings, then try again."
        : 'Pick the tab or window playing audio and enable "Share audio".';
      setErrorMessage(`Could not capture system audio. ${hint} (${msg})`);
      setSessionState("idle");
      return;
    }

    if (isStale()) {
      media.getTracks().forEach((t) => t.stop());
      return;
    }

    mediaStreamRef.current = media;

    // Register the live session BEFORE minting the Deepgram key so the
    // worker can bind the new key to this session. This is what lets an
    // admin terminate a recording mid-flight.
    const live = await startLiveSession({
      surface: isElectron ? "electron" : "web",
      metadata: { capture_mode: "system_audio_loopback" },
    });
    if (isStale()) {
      teardown();
      return;
    }
    if (!live) {
      setErrorMessage("Could not start session. Are you signed in?");
      teardown();
      return;
    }
    liveSessionIdRef.current = live.sessionId;

    let apiKeyResponse: CreateProjectKeyResponse;
    try {
      const res = await fetch(
        `${BACKEND_API_URL}/api/deepgram?sessionId=${encodeURIComponent(live.sessionId)}`,
        {
          cache: "no-store",
          credentials: "include",
        },
      );
      const object = await res.json();
      if (typeof object !== "object" || object === null || !("key" in object)) {
        throw new Error("No api key returned");
      }
      apiKeyResponse = object as CreateProjectKeyResponse;
    } catch (e) {
      console.error("Failed to get API key:", e);
      setErrorMessage("Failed to get API key. Please try again.");
      void endLiveSession(live.sessionId, "deepgram_key_failed");
      liveSessionIdRef.current = null;
      teardown();
      return;
    }

    if (isStale()) {
      teardown();
      return;
    }

    // Guard against an empty / missing key — passing "" through to
    // createClient would only fail later inside the WebSocket handshake
    // with an opaque error.
    if (!apiKeyResponse.key) {
      setErrorMessage("Deepgram returned an empty API key. Please retry.");
      void endLiveSession(live.sessionId, "deepgram_key_empty");
      liveSessionIdRef.current = null;
      teardown();
      return;
    }

    setSessionState("connecting");

    const deepgram = createClient(apiKeyResponse.key);
    const conn = deepgram.listen.live({
      model: "nova-2",
      interim_results: true,
      smart_format: true,
    });

    connectionRef.current = conn;

    conn.on(LiveTranscriptionEvents.Open, () => {
      if (isStale()) {
        try {
          conn.finish();
        } catch {
          /* ignore */
        }
        return;
      }

      setSessionState("live");

      const mic = new MediaRecorder(media);
      mediaRecorderRef.current = mic;

      mic.ondataavailable = (e) => {
        if (isStale() || !connectionRef.current) return;
        if (e.data.size > 0) {
          try {
            connectionRef.current.send(e.data);
          } catch {
            /* connection gone */
          }
        }
      };

      mic.start(500);

      posthog.capture("recording_started", {
        platform: isElectron ? "electron" : "browser",
        capture_mode: "system_audio_loopback",
      });
      trackEvent("recording_start", {
        sessionId: liveSessionIdRef.current,
        metadata: { platform: isElectron ? "electron" : "browser" },
      });
    });

    conn.on(LiveTranscriptionEvents.Close, () => {
      if (connectionRef.current !== conn) return;

      // If we still own a live session id when the WS closes, it usually
      // means an admin terminated this session (Deepgram revoked the key)
      // or the network blipped. Either way, mark it ended server-side
      // and surface a hint. The provider doesn't auto-reconnect — the
      // user must press Start again, which re-runs auth.
      const sid = liveSessionIdRef.current;
      if (sid && sessionStateRef.current === "live") {
        setErrorMessage(
          "Recording stopped. Your session may have been ended remotely.",
        );
        void endLiveSession(sid, "websocket_closed");
        liveSessionIdRef.current = null;
      }
      teardown();
    });

    conn.on(LiveTranscriptionEvents.Error, (error) => {
      console.error("Deepgram connection error:", error);
      if (connectionRef.current === conn) {
        teardown();
      }
    });

    conn.on(LiveTranscriptionEvents.Transcript, (data) => {
      if (isStale()) return;

      // Defensive: Deepgram has occasionally been observed sending
      // payloads without `alternatives` or `words`. Bail rather than
      // throwing inside an event handler (which would crash the WS).
      const alt = data?.channel?.alternatives?.[0];
      if (!alt || !Array.isArray(alt.words)) return;
      const words: DeepgramWord[] = alt.words;
      const caption = words
        .map((word) => word.punctuated_word ?? word.word)
        .join(" ");

      if (caption === "") return;

      setTranscribedText((prev) => (prev ? prev + " " + caption : caption));

      const startTime = words.length > 0 ? (words[0].start ?? 0) : 0;
      const endTime = words.length > 0 ? (words[words.length - 1].end ?? 0) : 0;

      const wordsData: TranscriptionWord[] = words.map((word) => ({
        word: word.word,
        punctuated_word: word.punctuated_word,
        start: word.start,
        end: word.end,
        confidence: word.confidence,
        speaker: data.channel.speaker,
      }));

      const segment: TranscriptionSegment = {
        id: `segment-${segmentCounterRef.current++}`,
        text: caption,
        words: wordsData,
        startTime,
        endTime,
        confidence:
          words.length > 0
            ? words.reduce((acc, w) => acc + (w.confidence ?? 0), 0) /
              words.length
            : 0,
        speaker: data.channel.speaker,
        isFinal: data.is_final ?? false,
        timestamp: new Date().toISOString(),
      };

      setTranscriptionSegments((prev) => {
        const existingIndex = prev.findIndex((s) => s.id === segment.id);
        if (existingIndex !== -1) {
          const updated = [...prev];
          updated[existingIndex] = segment;
          return updated;
        }
        return [...prev, segment];
      });
    });
  }, [isElectron, teardown]);

  const stopSession = useCallback(() => {
    sessionIdRef.current++;
    const sid = liveSessionIdRef.current;
    liveSessionIdRef.current = null;
    teardown();
    posthog.capture("recording_stopped", {
      platform: isElectron ? "electron" : "browser",
    });
    trackEvent("recording_stop", {
      sessionId: sid,
      metadata: { platform: isElectron ? "electron" : "browser" },
    });
    if (sid) void endLiveSession(sid, "user_stopped");
  }, [teardown, isElectron]);

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
      const sid = liveSessionIdRef.current;
      liveSessionIdRef.current = null;
      teardown();
      if (sid) void endLiveSession(sid, "client_unmount");
    };
  }, [teardown]);

  const isActive = sessionState !== "idle";
  const isBusy =
    sessionState === "fetching-key" || sessionState === "connecting";

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
