/** Codec selection + MediaRecorder construction with fallback.
 *
 *  MIME types in order of preference. webm/opus is the modern Chromium
 *  default and decodes cleanly server-side from the container header;
 *  the bare-webm fallback lets non-Chromium browsers still get something.
 *  We never fall through to MP4/AAC because Deepgram's container sniffer
 *  is less reliable on AAC frames and the latency hit on Safari isn't
 *  worth it for the Ask AI mic. */

export const PREFERRED_MIME_TYPES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/ogg;codecs=opus",
] as const;

export function pickMimeType(): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined;
  for (const t of PREFERRED_MIME_TYPES) {
    if (MediaRecorder.isTypeSupported(t)) return t;
  }
  return undefined;
}

export interface RecorderStartResult {
  recorder: MediaRecorder;
  mimeTypeLabel: string;
  triedMimeTypes: string[];
}

/** Construct + start the MediaRecorder with a fallback. Even though
 *  `MediaRecorder.isTypeSupported(t)` says "yes", Electron and some
 *  Chromium builds will still throw NotSupportedError out of `start()`
 *  for that combo (mismatch between codec advertised and codec the
 *  underlying media stream actually supports). We try each candidate
 *  in turn, then fall back to the browser default (no mimeType option),
 *  then finally signal failure by returning null. */
export function tryStartMediaRecorder(
  media: MediaStream,
  timesliceMs: number,
  onChunkFailure: (candidate: string | undefined, err: unknown) => void,
): RecorderStartResult | null {
  const triedMimeTypes: string[] = [];
  const candidates: (string | undefined)[] = [pickMimeType(), undefined];
  for (const candidate of candidates) {
    const candidateLabel = candidate ?? "(browser default)";
    triedMimeTypes.push(candidateLabel);
    try {
      const tentative = candidate
        ? new MediaRecorder(media, { mimeType: candidate })
        : new MediaRecorder(media);
      tentative.start(timesliceMs);
      return {
        recorder: tentative,
        mimeTypeLabel: candidateLabel,
        triedMimeTypes,
      };
    } catch (err) {
      onChunkFailure(candidate, err);
    }
  }
  return null;
}
