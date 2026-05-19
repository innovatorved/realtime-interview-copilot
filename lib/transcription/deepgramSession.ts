/** Plain-TS Deepgram live session for the system-audio interview pipeline.
 *
 *  Owns the full media + WS lifecycle so the React provider can stay a
 *  thin wrapper. The caller drives state via the supplied callbacks
 *  (`onState`, `onError`, `onSegment`, ...) and receives back a
 *  `{ stop }` handle. `stop()` is idempotent and tears down everything
 *  the session opened.
 *
 *  Strict behavior preservation: the existing TranscriptionContext call
 *  order — start live session → mint key → open WS → MediaRecorder —
 *  and every console log + posthog + trackEvent call is replicated
 *  here verbatim. */

import {
  type CreateProjectKeyResponse,
  createClient,
  type LiveClient,
  LiveTranscriptionEvents,
} from "@deepgram/sdk";
import posthog from "posthog-js";
import { BACKEND_API_URL } from "@/lib/constant";
import {
  endLiveSession,
  startLiveSession,
  trackEvent,
} from "@/lib/session-tracking";
import type { TranscriptionSegment, TranscriptionWord } from "@/lib/types";

export type SessionState = "idle" | "fetching-key" | "connecting" | "live";

interface DeepgramWord {
  word: string;
  punctuated_word?: string;
  start?: number;
  end?: number;
  confidence?: number;
}

export interface DeepgramSessionCallbacks {
  /** Whether the host environment is Electron. Pure UX: drives the
   *  permission-hint copy and telemetry tag. */
  isElectron: boolean;
  /** Stable counter source for segment ids — the consumer holds the
   *  ref so resetting a recording stays under their control. */
  nextSegmentId: () => string;
  onState: (state: SessionState) => void;
  onError: (message: string) => void;
  onTranscribedText: (updater: (prev: string) => string) => void;
  onSegment: (segment: TranscriptionSegment) => void;
}

export interface DeepgramSessionHandle {
  /** Idempotent. Tears down media, MediaRecorder, and WS. */
  stop: () => void;
  /** The live-session id minted server-side. Null until the live
   *  session is registered (early-fail paths). */
  getLiveSessionId: () => string | null;
}

/** Start a Deepgram live transcription session.
 *
 *  Resolves once the asynchronous startup is complete (one way or the
 *  other); the WS continues running in the background and drives the
 *  callbacks until `stop()` is called or the session ends remotely. */
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

  let connection: LiveClient | null = null;
  let mediaRecorder: MediaRecorder | null = null;
  let mediaStream: MediaStream | null = null;
  let liveSessionId: string | null = null;
  let stale = false;
  let currentState: SessionState = "idle";

  function setState(s: SessionState) {
    currentState = s;
    onState(s);
  }

  function teardown() {
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
    if (connection) {
      try {
        connection.finish();
      } catch {
        /* already closed */
      }
      connection = null;
    }
    setState("idle");
  }

  function stop() {
    stale = true;
    teardown();
  }

  const handle: DeepgramSessionHandle = {
    stop,
    getLiveSessionId: () => liveSessionId,
  };

  setState("fetching-key");

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
    onError(`Could not capture system audio. ${hint} (${msg})`);
    setState("idle");
    return handle;
  }

  if (stale) {
    media.getTracks().forEach((t) => t.stop());
    return handle;
  }
  mediaStream = media;

  // Register the live session BEFORE minting the Deepgram key so the
  // worker can bind the new key to this session. This is what lets an
  // admin terminate a recording mid-flight.
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
    onError("Failed to get API key. Please try again.");
    void endLiveSession(live.sessionId, "deepgram_key_failed");
    liveSessionId = null;
    teardown();
    return handle;
  }

  if (stale) {
    teardown();
    return handle;
  }

  // Guard against an empty / missing key — passing "" through to
  // createClient would only fail later inside the WebSocket handshake
  // with an opaque error.
  if (!apiKeyResponse.key) {
    onError("Deepgram returned an empty API key. Please retry.");
    void endLiveSession(live.sessionId, "deepgram_key_empty");
    liveSessionId = null;
    teardown();
    return handle;
  }

  setState("connecting");

  const deepgram = createClient(apiKeyResponse.key);
  const conn = deepgram.listen.live({
    model: "nova-2",
    interim_results: true,
    smart_format: true,
  });
  connection = conn;

  conn.on(LiveTranscriptionEvents.Open, () => {
    if (stale) {
      try {
        conn.finish();
      } catch {
        /* ignore */
      }
      return;
    }
    setState("live");

    const mic = new MediaRecorder(media);
    mediaRecorder = mic;
    mic.ondataavailable = (e) => {
      if (stale || !connection) return;
      if (e.data.size > 0) {
        try {
          connection.send(e.data);
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
      sessionId: liveSessionId,
      metadata: { platform: isElectron ? "electron" : "browser" },
    });
  });

  conn.on(LiveTranscriptionEvents.Close, () => {
    if (connection !== conn) return;

    // If we still own a live session id when the WS closes, it usually
    // means an admin terminated this session (Deepgram revoked the key)
    // or the network blipped. Either way, mark it ended server-side
    // and surface a hint. The provider doesn't auto-reconnect — the
    // user must press Start again, which re-runs auth.
    const sid = liveSessionId;
    if (sid && currentState === "live") {
      onError(
        "Recording stopped. Your session may have been ended remotely.",
      );
      void endLiveSession(sid, "websocket_closed");
      liveSessionId = null;
    }
    teardown();
  });

  conn.on(LiveTranscriptionEvents.Error, (error) => {
    console.error("Deepgram connection error:", error);
    if (connection === conn) {
      teardown();
    }
  });

  conn.on(LiveTranscriptionEvents.Transcript, (data) => {
    if (stale) return;

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

    onTranscribedText((prev) => (prev ? prev + " " + caption : caption));

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
      speaker: data.channel.speaker,
      isFinal: data.is_final ?? false,
      timestamp: new Date().toISOString(),
    };
    onSegment(segment);
  });

  return handle;
}
