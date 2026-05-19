/** Public Ask AI mic types. Kept in a tiny module so the hook + helper
 *  modules can share them without circular imports. */

export type AskMicState =
  | "idle"
  | "fetching-key"
  | "connecting"
  | "recording"
  | "stopping";

/**
 * Diagnostics counters surfaced by the hook so consumers (and our
 * on-screen debug HUD) can prove which stage of the mic → WS → Deepgram
 * pipeline is actually working. Without these the only signal a user
 * has when something silently fails is "no text appears", which is the
 * exact bug they reported.
 */
export interface AskMicStats {
  /** MediaRecorder ondataavailable invocations since last start(). */
  chunksSent: number;
  /** Cumulative bytes shipped to the Deepgram WS since last start(). */
  bytesSent: number;
  /** LiveTranscriptionEvents.Transcript events received from Deepgram. */
  transcriptEvents: number;
  /** Subset of `transcriptEvents` flagged `is_final: true`. */
  finalEvents: number;
  /** Subset of `transcriptEvents` that produced a non-empty caption. */
  captionedEvents: number;
  /** Ms elapsed between WS Open and first non-empty transcript caption. */
  firstCaptionMs: number | null;
  /** Snapshot of the last raw caption Deepgram returned. Useful for the HUD. */
  lastCaption: string;
  /** True once the WS is open and accepting audio. */
  wsOpen: boolean;
  /** MIME type the MediaRecorder is encoding with. Empty until recording. */
  mimeType: string;
}

export const EMPTY_STATS: AskMicStats = {
  chunksSent: 0,
  bytesSent: 0,
  transcriptEvents: 0,
  finalEvents: 0,
  captionedEvents: 0,
  firstCaptionMs: null,
  lastCaption: "",
  wsOpen: false,
  mimeType: "",
};
