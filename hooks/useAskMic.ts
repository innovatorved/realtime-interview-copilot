"use client";

import {
  closeDeepgramLive,
  connectDeepgramLive,
  isDeepgramResultsMessage,
  startDeepgramLiveConnection,
  type DeepgramLiveConnection,
} from "@/lib/transcription/deepgramLiveConnection";
import { useCallback, useEffect, useRef, useState } from "react";
import { dbg } from "@/lib/debug";
import { fetchAskMicKey } from "./mic/keyFetch";
import { createLevelMeter, type LevelMeterHandle } from "./mic/levelMeter";
import { tryStartMediaRecorder } from "./mic/mimePicker";
import { createStatsFlusher, type StatsFlusher } from "./mic/statsFlush";
import { type AskMicState, type AskMicStats, EMPTY_STATS } from "./mic/types";

export type { AskMicState, AskMicStats } from "./mic/types";

interface DeepgramWord {
  word: string;
  punctuated_word?: string;
}

interface DeepgramAlternative {
  transcript?: string;
  words?: DeepgramWord[];
}

interface UseAskMicOptions {
  /**
   * Called every time the in-progress transcript changes (interim + finals
   * concatenated). The consumer can mirror this into a text input live so
   * the user sees their words appear as they speak.
   */
  onTranscript?: (text: string) => void;
  /**
   * Called once when the mic recording is stopped via `stop()` (NOT
   * `cancel()`), with the final concatenated transcript. The consumer
   * typically auto-submits this. Won't fire if the transcript is empty.
   */
  onFinal?: (finalText: string) => void;
}

interface UseAskMicReturn {
  state: AskMicState;
  /** True for any non-idle state. Convenient for disabling other buttons. */
  isActive: boolean;
  /** Last error string, or null. Cleared on every fresh `start()`. */
  error: string | null;
  /**
   * Live transcript text (finals + the most recent interim chunk). Empty
   * string before the user has spoken.
   */
  transcript: string;
  /**
   * Current input audio level in [0, 1]. Driven by an AnalyserNode RMS so
   * the consumer can render a live waveform / volume bar — gives the user
   * proof that the microphone is actually picking up audio (without this
   * a silently-denied mic permission is indistinguishable from the user
   * just not talking).
   */
  level: number;
  /** Pipeline diagnostics counters; updated continuously during recording. */
  stats: AskMicStats;
  start: () => Promise<void>;
  /**
   * Stop the recording. Waits briefly for Deepgram to flush its trailing
   * final transcript so the last word isn't dropped. Fires `onFinal` with
   * the final text and returns it.
   */
  stop: () => Promise<string>;
  /**
   * Hard-cancel the recording. Identical to `stop()` in terms of teardown
   * but does NOT fire `onFinal` and does NOT auto-submit. Used by the
   * press-and-hold UI when the user drags off the button.
   */
  cancel: () => Promise<void>;
  /** Convenience toggle bound to a mic button (tap-to-toggle UX). */
  toggle: () => Promise<void>;
}

/**
 * Convenience shim around the app-wide debug helper. All Ask AI mic logs
 * are scoped under `[mic]` in the console so DevTools' filter can isolate
 * them. The flag is the global `?debug=1` / localStorage `app_debug=1` /
 * dev build — same switch used by completion fetches and the HUD.
 */
function dlog(...args: unknown[]) {
  dbg("mic", ...args);
}

/**
 * Realtime-mic transcription for the Ask AI input. Mints a short-lived
 * Deepgram key from `/api/deepgram` (no live-session binding — this is
 * an ad-hoc Q&A flow, not the system-audio interview pipeline) and streams
 * the user's microphone over a Deepgram live websocket.
 *
 * Designed for a press-and-hold mic button:
 *   - `start()`  → request mic, open WS, begin streaming
 *   - `stop()`   → graceful stop; waits ~400ms for Deepgram's trailing
 *                  final transcript, then fires `onFinal` for auto-submit
 *   - `cancel()` → hard teardown without firing `onFinal` (use when the
 *                  user drags off the button mid-press)
 *
 * Also exposes `level` for a live audio-level meter so the user has
 * visible proof their mic is being heard.
 */
export function useAskMic(options: UseAskMicOptions = {}): UseAskMicReturn {
  const { onTranscript, onFinal } = options;

  const [state, setState] = useState<AskMicState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [transcript, setTranscript] = useState<string>("");
  const [level, setLevel] = useState<number>(0);
  const [stats, setStats] = useState<AskMicStats>(EMPTY_STATS);

  // Mutable counters for the diagnostics HUD. We mirror these into
  // React state only ~10 Hz (see `statsFlusher`) so a fast audio pipeline
  // doesn't drown render with setState. Refs keep the source of truth.
  const chunksSentRef = useRef(0);
  const bytesSentRef = useRef(0);
  const transcriptEventsRef = useRef(0);
  const finalEventsRef = useRef(0);
  const captionedEventsRef = useRef(0);
  const lastCaptionRef = useRef<string>("");
  const wsOpenRef = useRef(false);
  const wsOpenedAtRef = useRef<number | null>(null);
  const firstCaptionMsRef = useRef<number | null>(null);
  const mimeTypeRef = useRef<string>("");

  const onTranscriptRef = useRef(onTranscript);
  const onFinalRef = useRef(onFinal);
  useEffect(() => {
    onTranscriptRef.current = onTranscript;
    onFinalRef.current = onFinal;
  }, [onTranscript, onFinal]);

  const connectionRef = useRef<DeepgramLiveConnection | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);

  // (No keep-alive: Ask AI utterances are short (1–10s) and either
  // commit or cancel quickly, so we never approach Deepgram's idle
  // timeout. Removing the 5s interval keeps the hot path simpler and
  // saves one timer per session.)

  // Audio level meter and stats flusher are managed via refs so the
  // hot path doesn't re-create them on each render.
  const levelMeterRef = useRef<LevelMeterHandle | null>(null);
  if (levelMeterRef.current === null) {
    levelMeterRef.current = createLevelMeter();
  }
  const statsFlusherRef = useRef<StatsFlusher | null>(null);
  if (statsFlusherRef.current === null) {
    statsFlusherRef.current = createStatsFlusher(() => {
      setStats({
        chunksSent: chunksSentRef.current,
        bytesSent: bytesSentRef.current,
        transcriptEvents: transcriptEventsRef.current,
        finalEvents: finalEventsRef.current,
        captionedEvents: captionedEventsRef.current,
        firstCaptionMs: firstCaptionMsRef.current,
        lastCaption: lastCaptionRef.current,
        wsOpen: wsOpenRef.current,
        mimeType: mimeTypeRef.current,
      });
    });
  }

  const stopLevelMeter = useCallback(() => {
    levelMeterRef.current?.stop();
    setLevel(0);
  }, []);

  const startLevelMeter = useCallback((media: MediaStream) => {
    levelMeterRef.current?.start(media, setLevel);
  }, []);

  // Accumulated FINAL chunks only — interim text is appended on top of this
  // for display but never persisted, so duplicate interim updates can't
  // cause the transcript to grow unbounded.
  const finalTextRef = useRef<string>("");
  const interimTextRef = useRef<string>("");
  // Set to `true` whenever Deepgram has at least one final transcript
  // pending. `stop()` uses this to decide whether it's worth waiting on
  // a trailing flush at all (avoids the 400ms wait when there's nothing
  // to wait for, e.g. user released instantly).
  const sawAnyFinalRef = useRef<boolean>(false);

  // Each call to start() bumps this. Async work checks `isStale()` to bail
  // out if a newer session has started. Prevents double-press races where
  // two parallel WS sessions could otherwise live concurrently.
  const sessionIdRef = useRef<number>(0);

  const teardown = useCallback(() => {
    stopLevelMeter();
    statsFlusherRef.current?.stop();
    wsOpenRef.current = false;
    if (mediaRecorderRef.current) {
      try {
        mediaRecorderRef.current.stop();
      } catch {
        /* already stopped */
      }
      mediaRecorderRef.current = null;
    }
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((t) => {
        t.stop();
      });
      mediaStreamRef.current = null;
    }
    if (connectionRef.current) {
      closeDeepgramLive(connectionRef.current);
      connectionRef.current = null;
    }
  }, [stopLevelMeter]);

  const composeText = useCallback((): string => {
    const finals = finalTextRef.current.trim();
    const interim = interimTextRef.current.trim();
    if (finals && interim) return `${finals} ${interim}`;
    return finals || interim;
  }, []);

  const start = useCallback(async () => {
    dlog("start() called; tearing down any prior session");
    teardown();
    finalTextRef.current = "";
    interimTextRef.current = "";
    sawAnyFinalRef.current = false;
    setTranscript("");
    setError(null);
    setLevel(0);
    // Reset diagnostics counters BEFORE any await so the HUD doesn't
    // show stale state from a previous session while we wait on perms.
    chunksSentRef.current = 0;
    bytesSentRef.current = 0;
    transcriptEventsRef.current = 0;
    finalEventsRef.current = 0;
    captionedEventsRef.current = 0;
    lastCaptionRef.current = "";
    wsOpenRef.current = false;
    wsOpenedAtRef.current = null;
    firstCaptionMsRef.current = null;
    mimeTypeRef.current = "";
    setStats(EMPTY_STATS);
    statsFlusherRef.current?.start();

    const thisSession = ++sessionIdRef.current;
    const isStale = () => sessionIdRef.current !== thisSession;

    setState("fetching-key");
    dlog("state → fetching-key (session", thisSession, ")");

    // Parallelize the two slow handshakes:
    //   - getUserMedia: cold-path waits on the OS permission prompt
    //     (~1–2s first time, ~10ms after). Stays sequential AFTER this.
    //   - /api/deepgram: ~200–500ms round-trip to mint a project key.
    //
    // Worst-case savings ≈ ~min(getUserMedia, fetch) ms vs running them
    // sequentially. If the user denies mic permission, the unused key
    // expires harmlessly on its short TTL. If the key call fails, we
    // stop the mic stream we just got.
    const t0 = performance.now();
    const [mediaResult, keyResult] = await Promise.allSettled([
      navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      }),
      fetchAskMicKey(),
    ]);
    dlog(
      "parallel handshake done in",
      Math.round(performance.now() - t0),
      "ms · mic:",
      mediaResult.status,
      "· key:",
      keyResult.status,
    );

    // Handle mic permission outcome first — without a mic there's no
    // point keeping the key.
    if (mediaResult.status === "rejected") {
      const err = mediaResult.reason;
      const msg = err instanceof Error ? err.message : String(err);
      const name = err instanceof Error ? err.name : "Unknown";
      dlog("getUserMedia FAILED:", name, msg);
      const isPermission =
        err instanceof Error &&
        (err.name === "NotAllowedError" || err.name === "SecurityError");
      setError(
        isPermission
          ? "Microphone permission denied. Allow mic access in System Settings → Privacy & Security → Microphone, then try again."
          : `Could not access microphone: ${msg}`,
      );
      setState("idle");
      statsFlusherRef.current?.stop();
      return;
    }
    const media = mediaResult.value;
    if (isStale()) {
      dlog("stale session after getUserMedia; tearing down stream");
      media.getTracks().forEach((t) => {
        t.stop();
      });
      return;
    }
    mediaStreamRef.current = media;
    // Spin up the level meter immediately — even before the WS opens —
    // so the user sees their voice register from the very first frame.
    // This is the single biggest "is anything happening?" signal.
    startLevelMeter(media);

    // Now handle key outcome — mic is already armed; if key failed we
    // tear it down.
    if (keyResult.status === "rejected") {
      const msg =
        keyResult.reason instanceof Error
          ? keyResult.reason.message
          : String(keyResult.reason);
      setError(`Could not get transcription key. ${msg}`);
      teardown();
      setState("idle");
      return;
    }
    const apiKey = keyResult.value.key;

    if (isStale()) {
      teardown();
      return;
    }

    // 3) Open the Deepgram live WS. Config matches the known-working
    //    TranscriptionContext exactly — `nova-2` + `interim_results` +
    //    `smart_format` (which already handles punctuation). We do NOT
    //    pass `endpointing` here: the SDK types declare it as `string`
    //    even though the wire API accepts ms-as-number, and passing the
    //    wrong shape was causing Deepgram to silently accept the WS but
    //    never emit Transcript events. We do NOT pass `punctuate: true`
    //    on top of smart_format either (redundant + sometimes conflicts).
    setState("connecting");
    dlog("state → connecting; minting Deepgram client");
    let conn: DeepgramLiveConnection;
    try {
      conn = await connectDeepgramLive(apiKey);
    } catch (connectErr) {
      console.error("[useAskMic] Deepgram connect failed:", connectErr);
      setError("Could not connect to transcription service. Try again.");
      teardown();
      setState("idle");
      return;
    }
    connectionRef.current = conn;

    conn.on("open", () => {
      if (isStale()) {
        dlog("WS Open fired but session is stale; closing immediately");
        closeDeepgramLive(conn);
        return;
      }

      wsOpenRef.current = true;
      wsOpenedAtRef.current = performance.now();
      setState("recording");
      dlog("WS Open; state → recording");

      // 4) Wire up MediaRecorder with an explicit mimeType so we don't
      //    inherit whatever the browser felt like today (Safari, in
      //    particular, picks formats Deepgram can't sniff). 250ms
      //    timeslice = ~4 chunks/sec, low-latency without flooding.
      const startResult = tryStartMediaRecorder(
        media,
        250,
        (candidate, err) => {
          console.warn(
            "[useAskMic] MediaRecorder rejected mimeType",
            candidate ?? "(default)",
            "—",
            err instanceof Error ? err.message : err,
          );
        },
      );
      if (!startResult) {
        console.error(
          "[useAskMic] no MediaRecorder mimeType worked, last error not retained",
        );
        setError(
          "Browser cannot start the microphone recorder. Try a different browser or restart the app.",
        );
        teardown();
        setState("idle");
        return;
      }
      const mic = startResult.recorder;
      mimeTypeRef.current = startResult.mimeTypeLabel;
      dlog(
        "MediaRecorder started with mimeType:",
        startResult.mimeTypeLabel,
        "· state:",
        mic.state,
      );
      mediaRecorderRef.current = mic;
      mic.ondataavailable = (e) => {
        if (isStale() || !connectionRef.current) return;
        if (e.data.size > 0) {
          try {
            connectionRef.current.sendMedia(e.data);
            chunksSentRef.current++;
            bytesSentRef.current += e.data.size;
            // Throttle: only log every 8th chunk (~2s) so DevTools
            // doesn't get spammed at 4 chunks/sec.
            if (chunksSentRef.current % 8 === 1) {
              dlog(
                "audio chunk",
                chunksSentRef.current,
                "sent;",
                e.data.size,
                "bytes (",
                bytesSentRef.current,
                "total)",
              );
            }
          } catch (sendErr) {
            console.warn("[useAskMic] WS send failed:", sendErr);
          }
        }
      };
      mic.onerror = (e) => {
        console.error("[useAskMic] MediaRecorder error:", e);
      };
    });

    conn.on("error", (err) => {
      console.error("[useAskMic] Deepgram WS error:", err);
      if (connectionRef.current !== conn) return;
      setError("Transcription connection error. Try again.");
      teardown();
      setState("idle");
    });

    conn.on("close", (ev) => {
      dlog("WS Close:", ev);
      if (connectionRef.current !== conn) return;
      wsOpenRef.current = false;
      if (sessionIdRef.current === thisSession) {
        setState("idle");
      }
    });

    conn.on("message", (data: unknown) => {
      if (isStale() || !isDeepgramResultsMessage(data)) return;
      transcriptEventsRef.current++;
      const isFinal = !!data.is_final;
      if (isFinal) finalEventsRef.current++;

      const alt = data.channel?.alternatives?.[0] as
        | DeepgramAlternative
        | undefined;
      if (!alt) {
        if (transcriptEventsRef.current <= 3) {
          dlog(
            "Transcript event #",
            transcriptEventsRef.current,
            "had no alternative — raw:",
            data,
          );
        }
        return;
      }

      const words = Array.isArray(alt.words) ? alt.words : [];
      const caption =
        words.length > 0
          ? words
              .map((w) => w.punctuated_word ?? w.word)
              .join(" ")
              .trim()
          : (alt.transcript ?? "").trim();
      if (!caption) return;
      captionedEventsRef.current++;
      lastCaptionRef.current = caption;

      if (
        firstCaptionMsRef.current === null &&
        wsOpenedAtRef.current !== null
      ) {
        firstCaptionMsRef.current = Math.round(
          performance.now() - wsOpenedAtRef.current,
        );
        dlog(
          "first caption arrived",
          firstCaptionMsRef.current,
          "ms after WS open:",
          JSON.stringify(caption),
        );
      } else if (captionedEventsRef.current <= 5) {
        dlog(
          isFinal ? "FINAL" : "interim",
          "#",
          captionedEventsRef.current,
          JSON.stringify(caption),
        );
      }

      if (isFinal) {
        finalTextRef.current = finalTextRef.current
          ? `${finalTextRef.current} ${caption}`
          : caption;
        interimTextRef.current = "";
        sawAnyFinalRef.current = true;
      } else {
        interimTextRef.current = caption;
      }

      const composed = composeText();
      setTranscript(composed);
      onTranscriptRef.current?.(composed);
    });

    startDeepgramLiveConnection(conn);
  }, [teardown, composeText, startLevelMeter]);

  // Wait up to `maxMs` for an additional final to land after the user
  // releases. Resolves early as soon as a final arrives. Used by `stop()`
  // so the last word ("…thanks") isn't dropped on quick releases.
  const waitForTrailingFinal = useCallback(
    async (maxMs: number): Promise<void> => {
      const conn = connectionRef.current;
      if (!conn) return;
      const hadInterim = interimTextRef.current.length > 0;
      if (!hadInterim) return; // nothing pending; no wait
      const finalsBefore = finalTextRef.current;
      const start = Date.now();
      await new Promise<void>((resolve) => {
        const id = setInterval(() => {
          const elapsed = Date.now() - start;
          const finalsChanged = finalTextRef.current !== finalsBefore;
          if (finalsChanged || elapsed >= maxMs) {
            clearInterval(id);
            resolve();
          }
        }, 50);
      });
    },
    [],
  );

  const stop = useCallback(async (): Promise<string> => {
    if (state === "idle") return "";
    dlog(
      "stop() — chunksSent:",
      chunksSentRef.current,
      "bytes:",
      bytesSentRef.current,
      "transcriptEvents:",
      transcriptEventsRef.current,
      "captioned:",
      captionedEventsRef.current,
    );
    setState("stopping");

    // Tell the encoder to flush + close the audio side first. The WS
    // keeps draining until we call finish().
    if (mediaRecorderRef.current) {
      try {
        mediaRecorderRef.current.stop();
      } catch {
        /* already stopped */
      }
      mediaRecorderRef.current = null;
    }
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((t) => {
        t.stop();
      });
      mediaStreamRef.current = null;
    }

    // Give Deepgram up to ~150ms to flush a final for any pending interim.
    // Short enough to feel instant; long enough to catch the trailing
    // word on a quick release. The wait short-circuits the moment a
    // final lands, so the worst-case 150ms only applies when there's
    // genuinely nothing more to wait for.
    await waitForTrailingFinal(150);

    stopLevelMeter();
    if (connectionRef.current) {
      closeDeepgramLive(connectionRef.current);
      connectionRef.current = null;
    }

    // Snapshot AFTER the optional flush so we pick up the trailing final.
    const finalText = composeText().trim();
    sessionIdRef.current++;
    setState("idle");
    dlog("stop() — final text:", JSON.stringify(finalText));
    if (finalText) onFinalRef.current?.(finalText);
    return finalText;
  }, [composeText, state, stopLevelMeter, waitForTrailingFinal]);

  const cancel = useCallback(async (): Promise<void> => {
    if (state === "idle") return;
    dlog("cancel() — dropping recording without submit");
    setState("stopping");
    sessionIdRef.current++;
    teardown();
    finalTextRef.current = "";
    interimTextRef.current = "";
    setTranscript("");
    setState("idle");
  }, [state, teardown]);

  const toggle = useCallback(async () => {
    if (state === "idle") {
      await start();
    } else if (state === "recording" || state === "connecting") {
      await stop();
    }
    // fetching-key / stopping are transient — ignore taps during them so
    // the user can't double-fire and confuse the WS.
  }, [state, start, stop]);

  // Hard teardown on unmount — never leak a mic stream / WS if the user
  // navigates away mid-recording.
  useEffect(() => {
    return () => {
      sessionIdRef.current++;
      teardown();
    };
  }, [teardown]);

  return {
    state,
    isActive: state !== "idle",
    error,
    transcript,
    level,
    stats,
    start,
    stop,
    cancel,
    toggle,
  };
}
