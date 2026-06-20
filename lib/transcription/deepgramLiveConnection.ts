/** Deepgram SDK v5 live WebSocket helpers for browser + Electron renderers. */

import { DeepgramClient } from "@deepgram/sdk";

export interface DeepgramProjectKeyResponse {
  key: string;
}

/** Minimal surface we use from `listen.v1.connect()`. */
export interface DeepgramLiveConnection {
  on: (event: string, callback: (...args: unknown[]) => void) => void;
  connect: () => DeepgramLiveConnection;
  waitForOpen: () => Promise<unknown>;
  sendMedia: (message: Blob) => void;
  sendCloseStream: (message: { type: string }) => void;
  close: () => void;
}

export interface DeepgramLiveOptions {
  model?: string;
}

export async function connectDeepgramLive(
  apiKey: string,
  options: DeepgramLiveOptions = {},
): Promise<DeepgramLiveConnection> {
  const deepgram = new DeepgramClient({ apiKey });
  const conn = await deepgram.listen.v1.connect({
    Authorization: apiKey,
    model: options.model ?? "nova-2",
    interim_results: "true",
    smart_format: "true",
  });
  return conn as DeepgramLiveConnection;
}

export function startDeepgramLiveConnection(
  conn: DeepgramLiveConnection,
): void {
  conn.connect();
}

export function closeDeepgramLive(conn: DeepgramLiveConnection): void {
  try {
    conn.sendCloseStream({ type: "CloseStream" });
  } catch {
    /* already closed */
  }
  try {
    conn.close();
  } catch {
    /* already closed */
  }
}

export interface DeepgramResultsMessage {
  type?: string;
  is_final?: boolean;
  channel?: {
    speaker?: number;
    alternatives?: Array<{
      transcript?: string;
      words?: Array<{
        word: string;
        punctuated_word?: string;
        start?: number;
        end?: number;
        confidence?: number;
      }>;
    }>;
  };
}

export function isDeepgramResultsMessage(
  data: unknown,
): data is DeepgramResultsMessage {
  return (
    typeof data === "object" &&
    data !== null &&
    "type" in data &&
    (data as DeepgramResultsMessage).type === "Results"
  );
}

/** Exponential backoff delay for live-session reconnect attempts. */
export const DEEPGRAM_RECONNECT_MAX_ATTEMPTS = 5;
export const DEEPGRAM_RECONNECT_BASE_MS = 1000;
export const DEEPGRAM_RECONNECT_MAX_MS = 30_000;

export function deepgramReconnectDelayMs(attempt: number): number {
  const capped = Math.min(
    DEEPGRAM_RECONNECT_MAX_MS,
    DEEPGRAM_RECONNECT_BASE_MS * 2 ** attempt,
  );
  return capped + Math.floor(Math.random() * 500);
}
