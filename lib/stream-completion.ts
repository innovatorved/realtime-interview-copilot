import { humanizeError, parseApiErrorResponse } from "@/lib/api-errors";
import { ricFetch } from "@/lib/ric-fetch";
import { parseSseStream } from "@/lib/sse";
import { FLAGS } from "@/lib/types";

const SSE_CLIENT_BUFFER_MAX = 1_000_000;

interface StreamCompletionParams {
  flag: FLAGS;
  bg: string;
  prompt: string;
  signal: AbortSignal;
  image?: string | string[];
  onChunk: (text: string) => void;
}

export async function streamCompletion({
  flag,
  bg,
  prompt,
  signal,
  image,
  onChunk,
}: StreamCompletionParams): Promise<void> {
  const response = await ricFetch("/api/completion", {
    method: "POST",
    body: JSON.stringify({
      bg,
      flag,
      prompt,
      ...(image !== undefined ? { image } : {}),
    }),
    signal,
  });

  if (!response.ok) {
    const message = await parseApiErrorResponse(response);
    throw new Error(message);
  }

  let streamError: string | null = null;
  await parseSseStream(response, {
    signal,
    maxBufferChars: SSE_CLIENT_BUFFER_MAX,
    onChunk: (delta) => {
      if (delta.text) {
        onChunk(delta.text);
      }
    },
    onError: (message) => {
      streamError = message;
    },
    onParseError: (err) => {
      console.error("Error parsing SSE data:", err);
    },
  });

  if (streamError) {
    throw new Error(streamError);
  }
}

export function isAbortError(err: unknown): boolean {
  return err instanceof Error && err.name === "AbortError";
}

export function humanizeStreamError(err: unknown): string {
  return humanizeError(err);
}
