"use client";

import {
  CreateProjectKeyResponse,
  LiveClient,
  LiveTranscriptionEvents,
  createClient,
} from "@deepgram/sdk";
import { useState, useEffect, useCallback, useRef } from "react";
import { MicIcon } from "@/components/ui/icon";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Loader2, MicOffIcon } from "lucide-react";
import { TranscriptionSegment, TranscriptionWord } from "@/lib/types";
import { useClientReady } from "@/hooks/useClientReady";
import { BACKEND_API_URL } from "@/lib/constant";
import posthog from "posthog-js";
import {
  endLiveSession,
  startLiveSession,
  trackEvent,
} from "@/lib/session-tracking";

interface RecorderTranscriberProps {
  addTextinTranscription: (text: string) => void;
  addTranscriptionSegment?: (segment: TranscriptionSegment) => void;
}

type SessionState = "idle" | "fetching-key" | "connecting" | "live";

export default function RecorderTranscriber({
  addTextinTranscription,
  addTranscriptionSegment,
}: RecorderTranscriberProps) {
  const isClientReady = useClientReady();

  const [isElectron, setIsElectron] = useState<boolean | null>(null);
  const [sessionState, setSessionState] = useState<SessionState>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const connectionRef = useRef<LiveClient | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const segmentCounterRef = useRef<number>(0);
  const sessionIdRef = useRef<number>(0);
  const liveSessionIdRef = useRef<string | null>(null);

  const addTextRef = useRef(addTextinTranscription);
  addTextRef.current = addTextinTranscription;
  const addSegmentRef = useRef(addTranscriptionSegment);
  addSegmentRef.current = addTranscriptionSegment;

  const teardown = useCallback(() => {
    if (mediaRecorderRef.current) {
      try { mediaRecorderRef.current.stop(); } catch { /* already stopped */ }
      mediaRecorderRef.current = null;
    }

    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((track) => track.stop());
      mediaStreamRef.current = null;
    }

    if (connectionRef.current) {
      try { connectionRef.current.finish(); } catch { /* already closed */ }
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
      // screen and pairs it with system-audio loopback, so no picker appears.
      // In the browser build, the user picks a tab/window and enables
      // "Share audio" to grant system/tab audio.
      // NOTE: Electron 41 / Chromium rejects advanced audio constraints
      // (echoCancellation, sampleRate, channelCount, etc.) on
      // getDisplayMedia with "Invalid capture constraints". For display
      // capture we must pass `audio: true` (or an empty object) and let
      // the loopback source decide the format.
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
        : "Pick the tab or window playing audio and enable \"Share audio\".";
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
    // admin terminate a recording mid-flight: they delete the upstream
    // key, Deepgram closes the WebSocket, and our LiveTranscriptionEvents.Close
    // handler tears the recorder down. No client-side polling needed.
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
      // End the session we just registered so it doesn't sit there as
      // "active" with no key bound.
      void endLiveSession(live.sessionId, "deepgram_key_failed");
      liveSessionIdRef.current = null;
      teardown();
      return;
    }

    if (isStale()) {
      teardown();
      return;
    }

    setSessionState("connecting");

    const deepgram = createClient(apiKeyResponse.key ?? "");
    const conn = deepgram.listen.live({
      model: "nova-2",
      interim_results: true,
      smart_format: true,
    });

    connectionRef.current = conn;

    conn.on(LiveTranscriptionEvents.Open, () => {
      if (isStale()) {
        try { conn.finish(); } catch { /* ignore */ }
        return;
      }

      setSessionState("live");

      const mic = new MediaRecorder(media);
      mediaRecorderRef.current = mic;

      mic.ondataavailable = (e) => {
        if (isStale() || !connectionRef.current) return;
        if (e.data.size > 0) {
          try { connectionRef.current.send(e.data); } catch { /* connection gone */ }
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

      // If we still own a live session id when the WS closes, it means
      // either (a) Deepgram revoked the key — almost always because an
      // admin terminated this session — or (b) network blip. Either way,
      // mark the session ended server-side and surface a hint to the
      // candidate. The recorder doesn't try to reconnect; the user must
      // press Start again, which will go through auth again.
      const sid = liveSessionIdRef.current;
      if (sid && sessionState === "live") {
        setErrorMessage("Recording stopped. Your session may have been ended remotely.");
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

      const words = data.channel.alternatives[0].words;
      const caption = words
        .map((word: any) => word.punctuated_word ?? word.word)
        .join(" ");

      if (caption === "") return;

      addTextRef.current(caption);

      if (addSegmentRef.current) {
        const startTime = words.length > 0 ? (words[0].start ?? 0) : 0;
        const endTime =
          words.length > 0 ? (words[words.length - 1].end ?? 0) : 0;

        const wordsData: TranscriptionWord[] = words.map((word: any) => ({
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
            words.reduce(
              (acc: number, w: any) => acc + (w.confidence ?? 0),
              0,
            ) / words.length,
          speaker: data.channel.speaker,
          isFinal: data.is_final ?? false,
          timestamp: new Date().toISOString(),
        };

        addSegmentRef.current(segment);
      }
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

  useEffect(() => {
    setIsElectron(typeof window !== "undefined" && !!window.electronAPI);
  }, []);

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
  const isBusy = sessionState === "fetching-key" || sessionState === "connecting";

  return (
    <div className="w-full relative">
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2 p-1 bg-zinc-950/50 rounded-lg border border-white/5 h-10">
          {isBusy ? (
            <div className="flex-1 flex items-center justify-center gap-2 text-zinc-400 text-xs" role="status" aria-live="polite">
              <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-emerald-500/80" />
              <span>{sessionState === "fetching-key" ? "Fetching API key…" : "Connecting…"}</span>
            </div>
          ) : (
            <div className="flex-1 flex items-center gap-2 px-2 min-w-0">
              <span className="text-zinc-500 text-[10px] uppercase tracking-wider font-semibold shrink-0">
                Source
              </span>
              <span className="text-zinc-300 text-xs truncate">
                {isElectron
                  ? "System audio (loudspeaker)"
                  : "Browser tab / window audio"}
              </span>
            </div>
          )}

          <Button
            className={cn(
              "h-8 px-4 text-xs font-medium transition-all duration-300 shrink-0",
              sessionState === "live"
                ? "bg-red-500/10 text-red-400 hover:bg-red-500/20 hover:text-red-300 border border-red-500/20"
                : "bg-green-500/10 text-green-400 hover:bg-green-500/20 hover:text-green-300 border border-green-500/20",
            )}
            size="sm"
            onClick={isActive ? stopSession : startSession}
            disabled={isBusy || !isClientReady}
          >
            {!isActive ? (
              <div className="flex items-center gap-2">
                <MicIcon className="h-3 w-3" />
                Start Listening
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <MicOffIcon className="h-3 w-3" />
                Stop
              </div>
            )}
          </Button>
        </div>

        <div className="flex items-center justify-between px-1 h-4">
          <div className="flex items-center gap-2">
            <div
              className={cn(
                "w-1.5 h-1.5 rounded-full transition-colors",
                sessionState === "live"
                  ? "bg-green-500 animate-pulse"
                  : isActive
                    ? "bg-yellow-500"
                    : "bg-zinc-700",
              )}
            />
            <span className="text-[10px] text-zinc-500 font-medium uppercase tracking-wider">
              {sessionState === "live"
                ? "Live & Connected"
                : sessionState === "idle"
                  ? "Ready"
                  : "Connecting..."}
            </span>
          </div>
          {sessionState === "live" && (
            <span className="text-[10px] text-green-500/70 font-mono animate-pulse">
              REC
            </span>
          )}
        </div>

        {errorMessage && (
          <div
            role="alert"
            className="flex items-start gap-2 px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/25 text-red-200 text-[11px] leading-snug"
          >
            <span className="flex-1">{errorMessage}</span>
            <button
              type="button"
              onClick={() => setErrorMessage(null)}
              className="shrink-0 text-red-300/70 hover:text-red-200 transition-colors"
              aria-label="Dismiss"
            >
              ×
            </button>
          </div>
        )}

      </div>
    </div>
  );
}
