/** Mint a short-lived Deepgram key for the Ask AI mic flow.
 *
 *  Separated out so the hook can `Promise.allSettled` it alongside
 *  `getUserMedia` without inlining auth/rate-limit error mapping.
 *
 *  Hits the dedicated `/api/deepgram/ask` endpoint, NOT `/api/deepgram` —
 *  the two are intentionally separate so Ask-AI mic keys land in their
 *  own per-user rate-limit bucket and analytics stream (`source:
 *  ask_mic`), and so a future live_session binding on the transcript
 *  endpoint never accidentally applies here. */

import type { DeepgramProjectKeyResponse } from "@/lib/transcription/deepgramLiveConnection";
import { ricFetch } from "@/lib/ric-fetch";

export async function fetchAskMicKey(): Promise<DeepgramProjectKeyResponse> {
  const res = await ricFetch("/api/deepgram/ask", {
    method: "GET",
    cache: "no-store",
  });
  if (!res.ok) {
    if (res.status === 401 || res.status === 403) {
      throw new Error("Please sign in to use voice input.");
    }
    if (res.status === 429) {
      throw new Error("Voice input rate-limited. Wait a moment and try again.");
    }
    throw new Error(`Key endpoint returned ${res.status}`);
  }
  const body = (await res.json()) as Partial<DeepgramProjectKeyResponse>;
  if (!body || typeof body.key !== "string" || !body.key) {
    throw new Error("Key endpoint returned no key");
  }
  return body as DeepgramProjectKeyResponse;
}
