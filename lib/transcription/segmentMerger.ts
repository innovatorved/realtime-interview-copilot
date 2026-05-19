/** Pure merge for live-transcription segments.
 *
 *  Used by `TranscriptionContext` when a new `TranscriptionSegment` arrives
 *  from the Deepgram WebSocket. The provider assigns a fresh, ever-
 *  incrementing id per event so in practice an id collision never fires —
 *  this duplicate-id replace path is kept defensive in case Deepgram (or
 *  a future buffering layer) ever surfaces a final that supersedes an
 *  earlier interim with the same id. */

import type { TranscriptionSegment } from "@/lib/types";

export function mergeSegments(
  prev: readonly TranscriptionSegment[],
  incoming: TranscriptionSegment,
): TranscriptionSegment[] {
  const existingIndex = prev.findIndex((s) => s.id === incoming.id);
  if (existingIndex !== -1) {
    const updated = prev.slice();
    updated[existingIndex] = incoming;
    return updated;
  }
  return [...prev, incoming];
}
