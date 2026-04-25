/**
 * Streaming helper for direct calls to a user's BYOK OpenAI-compatible
 * endpoint. Handles SSE parsing using the same buffered-line strategy
 * as the worker (`streamOpenAICompatibleCompletion` in
 * `realtime-worker-api/src/index.ts`).
 *
 * Behaviour intentionally mirrors what the worker would have streamed
 * back to the renderer, so the calling components (`copilot.tsx`,
 * `QuestionAssistant.tsx`) can stay agnostic to whether BYOK or the
 * worker is in use — they only consume `{ text }` deltas.
 */

import type { ByokOpenAIConfig } from "@/lib/byok-client";

export interface OpenAIStreamRequest {
  config: ByokOpenAIConfig;
  /** Combined system / background context. */
  bg: string;
  /** Full user prompt (transcription, question, etc.). */
  prompt: string;
  /** Optional data: URL image attachment (PNG/JPEG/...). */
  image?: string | null;
  /** Cooperative cancel signal. */
  signal: AbortSignal;
  onDelta: (text: string) => void;
}

const SSE_BUFFER_MAX = 1_000_000;

interface OpenAIMessageContentText {
  type: "text";
  text: string;
}
interface OpenAIMessageContentImage {
  type: "image_url";
  image_url: { url: string };
}

type OpenAIMessageContent = OpenAIMessageContentText | OpenAIMessageContentImage;

export async function streamByokOpenAI(req: OpenAIStreamRequest): Promise<void> {
  const url = `${req.config.baseUrl.replace(/\/+$/, "")}/chat/completions`;

  const userContent: OpenAIMessageContent[] = [{ type: "text", text: req.prompt }];
  if (req.image) {
    userContent.push({ type: "image_url", image_url: { url: req.image } });
  }

  const messages: Array<{
    role: "system" | "user";
    content: string | OpenAIMessageContent[];
  }> = [];
  if (req.bg && req.bg.trim()) {
    messages.push({ role: "system", content: req.bg });
  }
  messages.push({ role: "user", content: userContent });

  const body = {
    model: req.config.modelName ?? "gpt-4o-mini",
    stream: true,
    messages,
  };

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${req.config.token}`,
      Accept: "text/event-stream",
    },
    body: JSON.stringify(body),
    signal: req.signal,
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`Upstream ${res.status}: ${txt.slice(0, 200)}`);
  }
  if (!res.body) throw new Error("Response body is null");

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    if (buffer.length > SSE_BUFFER_MAX) {
      throw new Error("SSE buffer overflow");
    }

    let sepIdx: number;
    while ((sepIdx = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, sepIdx).trim();
      buffer = buffer.slice(sepIdx + 1);
      if (!line || !line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (payload === "[DONE]") return;

      try {
        const parsed = JSON.parse(payload) as {
          choices?: Array<{ delta?: { content?: string } }>;
        };
        const delta = parsed.choices?.[0]?.delta?.content;
        if (typeof delta === "string" && delta.length > 0) {
          req.onDelta(delta);
        }
      } catch {
        // Ignore malformed chunks — non-fatal.
      }
    }
  }
}
