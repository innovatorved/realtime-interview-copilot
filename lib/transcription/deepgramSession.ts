/** Plain-TS Deepgram live session for the system-audio interview pipeline.
 *
 *  Owns the full media + WS lifecycle so the React provider can stay a
 *  thin wrapper. The caller drives state via the supplied callbacks
 *  (`onState`, `onError`, `onSegment`, ...) and receives back a
 *  `{ stop }` handle. `stop()` is idempotent and tears down everything
 *  the session opened.
 *
 *  On unexpected WebSocket drops while live, re-mints a key and reconnects
 *  with exponential backoff before surfacing a fatal error. */

import {
  type DeepgramProjectKeyResponse,
  closeDeepgramLive,
  connectDeepgramLive,
  deepgramReconnectDelayMs,
  DEEPGRAM_RECONNECT_MAX_ATTEMPTS,
  isDeepgramResultsMessage,
  startDeepgramLiveConnection,
  type DeepgramLiveConnection,
} from "@/lib/transcription/deepgramLiveConnection";
import posthog from "posthog-js";
import { ricFetch } from "@/lib/ric-fetch";
import {
  endLiveSession,
  startLiveSession,
  trackEvent,
} from "@/lib/session-tracking";
import type { TranscriptionSegment, TranscriptionWord } from "@/lib/types";

export type SessionState =
  | "idle"
  | "fetching-key"
  | "connecting"
  | "live"
  | "reconnecting";

interface DeepgramWord {
  word: string;
  punctuated_word?: string;
  start?: number;
  end?: number;
  confidence?: number;
}

export interface DeepgramSessionCallbacks {
  isElectron: boolean;
  nextSegmentId: () => string;
  onState: (state: SessionState) => void;
  onError: (message: string) => void;
  onTranscribedText: (updater: (prev: string) => string) => void;
  onSegment: (segment: TranscriptionSegment) => void;
}

export interface DeepgramSessionHandle {
  stop: () => void;
  getLiveSessionId: () => string | null;
}

async function mintDeepgramKey(sessionId: string): Promise<string> {
  const res = await ricFetch(
    `/api/deepgram?sessionId=${encodeURIComponent(sessionId)}`,
    { cache: "no-store" },
  );
  const object = await res.json();
  if (typeof object !== "object" || object === null || !("key" in object)) {
    throw new Error("No api key returned");
  }
  const apiKeyResponse = object as DeepgramProjectKeyResponse;
  if (!apiKeyResponse.key) {
    throw new Error("Deepgram returned an empty API key");
  }
  return apiKeyResponse.key;
}

/** Start a Deepgram live transcription session. */
export async function startDeepgramSession(
  callbacks: DeepgramSessionCallbacks,
): Promise<DeepgramSessionHandle> {
  const {
    isElectron,
    nextSegmentId,
    onState,
    onError,
    onTranscribedText,
    onSegment,
  } = callbacks;

  let connection: DeepgramLiveConnection | null = null;
  let mediaRecorder: MediaRecorder | null = null;
  let mediaStream: MediaStream | null = null;
  let liveSessionId: string | null = null;
  let stale = false;
  let currentState: SessionState = "idle";
  let reconnectAttempt = 0;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let recordingStarted = false;

  function setState(s: SessionState) {
    currentState = s;
    onState(s);
  }

  function clearReconnectTimer() {
    if (reconnectTimer !== null) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
  }

  function teardownMedia() {
    if (mediaRecorder) {
      try {
        mediaRecorder.stop();
      } catch {
        /* already stopped */
      }
      mediaRecorder = null;
    }
    if (mediaStream) {
      mediaStream.getTracks().forEach((track) => track.stop());
      mediaStream = null;
    }
    recordingStarted = false;
  }

  function teardownConnection() {
    if (connection) {
      closeDeepgramLive(connection);
      connection = null;
    }
  }

  function teardown() {
    clearReconnectTimer();
    teardownMedia();
    teardownConnection();
    setState("idle");
  }

  function stop() {
    stale = true;
    clearReconnectTimer();
    teardown();
  }

  const handle: DeepgramSessionHandle = {
    stop,
    getLiveSessionId: () => liveSessionId,
  };

  function bindMessageHandler(conn: DeepgramLiveConnection) {
    conn.on("message", (data: unknown) => {
      if (stale || !isDeepgramResultsMessage(data)) return;

      const alt = data.channel?.alternatives?.[0];
      if (!alt || !Array.isArray(alt.words)) return;
      const words: DeepgramWord[] = alt.words;
      const caption = words
        .map((word) => word.punctuated_word ?? word.word)
        .join(" ");

      if (caption === "") return;

      onTranscribedText((prev) => (prev ? prev + " " + caption : caption));

      const startTime = words.length > 0 ? (words[0].start ?? 0) : 0;
      const endTime = words.length > 0 ? (words[words.length - 1].end ?? 0) : 0;

      const wordsData: TranscriptionWord[] = words.map((word) => ({
        word: word.word,
        punctuated_word: word.punctuated_word,
        start: word.start,
        end: word.end,
        confidence: word.confidence,
        speaker: data.channel?.speaker,
      }));

      const segment: TranscriptionSegment = {
        id: nextSegmentId(),
        text: caption,
        words: wordsData,
        startTime,
        endTime,
        confidence:
          words.length > 0
            ? words.reduce((acc, w) => acc + (w.confidence ?? 0), 0) /
              words.length
            : 0,
        speaker: data.channel?.speaker,
        isFinal: data.is_final ?? false,
        timestamp: new Date().toISOString(),
      };
      onSegment(segment);
    });
  }

  function startRecorderIfNeeded(media: MediaStream) {
    if (recordingStarted || stale || !connection) return;
    const mic = new MediaRecorder(media);
    mediaRecorder = mic;
    mic.ondataavailable = (e) => {
      if (stale || !connection) return;
      if (e.data.size > 0) {
        try {
          connection.sendMedia(e.data);
        } catch {
          /* connection gone */
        }
      }
    };
    mic.start(500);
    recordingStarted = true;

    if (currentState !== "live") {
      posthog.capture("recording_started", {
        platform: isElectron ? "electron" : "browser",
        capture_mode: "system_audio_loopback",
      });
      trackEvent("recording_start", {
        sessionId: liveSessionId,
        metadata: { platform: isElectron ? "electron" : "browser" },
      });
    }
  }

  function scheduleReconnect(reason: string) {
    if (stale || !liveSessionId || !mediaStream) return;
    if (reconnectAttempt >= DEEPGRAM_RECONNECT_MAX_ATTEMPTS) {
      onError(
        "Transcription connection lost. Please stop and start recording again.",
      );
      const sid = liveSessionId;
      void endLiveSession(sid, reason);
      liveSessionId = null;
      teardown();
      return;
    }

    teardownConnection();
    setState("reconnecting");
    const delay = deepgramReconnectDelayMs(reconnectAttempt);
    reconnectAttempt++;

    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      void reconnectLive(reason);
    }, delay);
  }

  async function openConnection(apiKey: string, media: MediaStream) {
    const conn = await connectDeepgramLive(apiKey);
    connection = conn;
    bindMessageHandler(conn);

    conn.on("open", () => {
      if (stale) {
        closeDeepgramLive(conn);
        return;
      }
      reconnectAttempt = 0;
      setState("live");
      startRecorderIfNeeded(media);
    });

    conn.on("close", () => {
      if (connection !== conn || stale) return;
      if (currentState === "live" || currentState === "reconnecting") {
        scheduleReconnect("websocket_closed");
        return;
      }
      teardownConnection();
    });

    conn.on("error", (error) => {
      console.error("Deepgram connection error:", error);
      if (connection !== conn || stale) return;
      if (currentState === "live" || currentState === "reconnecting") {
        scheduleReconnect("websocket_error");
        return;
      }
      teardownConnection();
    });

    startDeepgramLiveConnection(conn);
  }

  async function reconnectLive(reason: string) {
    if (stale || !liveSessionId || !mediaStream) return;
    const sid = liveSessionId;
    const media = mediaStream;

    setState("reconnecting");
    try {
      const apiKey = await mintDeepgramKey(sid);
      if (stale) return;
      await openConnection(apiKey, media);
    } catch (e) {
      console.error("Deepgram reconnect failed:", e);
      if (stale) return;
      scheduleReconnect(reason);
    }
  }

  setState("fetching-key");

  let media: MediaStream;
  try {
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
    onError(`Could not capture system audio. ${hint} (${msg})`);
    setState("idle");
    return handle;
  }

  if (stale) {
    media.getTracks().forEach((t) => t.stop());
    return handle;
  }
  mediaStream = media;

  const live = await startLiveSession({
    surface: isElectron ? "electron" : "web",
    metadata: { capture_mode: "system_audio_loopback" },
  });
  if (stale) {
    teardown();
    return handle;
  }
  if (!live) {
    onError("Could not start session. Are you signed in?");
    teardown();
    return handle;
  }
  liveSessionId = live.sessionId;

  setState("connecting");

  try {
    const apiKey = await mintDeepgramKey(live.sessionId);
    if (stale) {
      teardown();
      return handle;
    }
    await openConnection(apiKey, media);
  } catch (e) {
    console.error("Failed to start Deepgram session:", e);
    onError("Failed to connect to transcription service. Please try again.");
    void endLiveSession(live.sessionId, "deepgram_connect_failed");
    liveSessionId = null;
    teardown();
  }

  return handle;
}
