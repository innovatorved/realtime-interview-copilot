/** OpenAI-compatible (custom model) streaming completion provider. */

import { fetchWithRetry } from "../lib/fetch-retry";
import { encoder } from "../lib/http";
import type { ModelParams } from "../config-cache";
import { SSE_BUFFER_MAX, type WireMessage } from "./completion-types";

export async function streamOpenAICompatibleCompletion(
  messages: WireMessage[],
  modelName: string,
  apiKey: string,
  baseUrl: string,
  writer: WritableStreamDefaultWriter<Uint8Array>,
  params: ModelParams,
) {
  if (!apiKey || !baseUrl) {
    throw new Error(
      "Missing custom model API key or base URL — configure in Admin Dashboard Settings",
    );
  }
  if (messages.length === 0) {
    throw new Error("streamOpenAICompatibleCompletion: messages[] is empty");
  }

  const endpoint = baseUrl.replace(/\/+$/, "") + "/chat/completions";

  // Map wire-format messages → OpenAI `messages` array. A message with
  // images uses the multimodal `content` array form ({type: "text"|
  // "image_url"}); a text-only message uses a plain string. Some
  // OpenAI-compatible providers (e.g. older self-hosted servers) reject
  // image_url on `assistant` messages, so we attach images only on user
  // turns — assistant text comes through verbatim.
  const apiMessages = messages.map((m) => {
    if (m.role === "user" && m.images.length > 0) {
      return {
        role: m.role,
        content: [
          { type: "text", text: m.text } as Record<string, unknown>,
          ...m.images.map(
            (image) =>
              ({
                type: "image_url",
                image_url: {
                  url: `data:${image.mimeType};base64,${image.base64}`,
                },
              }) as Record<string, unknown>,
          ),
        ],
      };
    }
    return { role: m.role, content: m.text };
  });

  const requestBody = JSON.stringify({
    model: modelName,
    stream: true,
    max_tokens: params.maxOutputTokens,
    temperature: params.temperature,
    top_p: params.topP,
    messages: apiMessages,
  });

  try {
    const response = await fetchWithRetry(
      endpoint,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: requestBody,
      },
      // streaming: true ensures the 10s timeout only covers connect +
      // time-to-first-byte; the body read can take as long as the
      // completion needs. Without this, completions that take >10s
      // are aborted mid-stream with an AbortError that surfaces as
      // "Something went wrong. Please try again." in the UI.
      { retries: 2, baseMs: 250, timeoutMs: 10_000, streaming: true },
    );

    if (!response.ok) {
      let errorBody = "Could not read error body";
      try {
        errorBody = await response.text();
      } catch {
        /* ignore */
      }
      // Trim body so we don't write back 100KB HTML error pages over SSE.
      const trimmed = errorBody.slice(0, 800);
      throw new Error(
        `Custom model API error ${response.status} ${response.statusText} from ${endpoint}: ${trimmed}`,
      );
    }

    if (!response.body) throw new Error("Response body is null");

    const reader = response.body
      .pipeThrough(new TextDecoderStream())
      .getReader();
    let buffer = "";

    /** Forward one parsed JSON event from the upstream SSE stream. */
    const forwardEvent = async (payload: string): Promise<void> => {
      if (!payload || payload === "[DONE]") return;
      let parsed: {
        choices?: {
          delta?: {
            content?:
              | string
              | Array<{ type?: string; text?: string }>
              | null;
            reasoning_content?: string | null;
          };
        }[];
        error?: { message?: string } | string;
      };
      try {
        parsed = JSON.parse(payload);
      } catch {
        return;
      }
      // Some providers stream an explicit `{"error": ...}` chunk on
      // mid-stream failures (rate-limit hits, model overloaded, etc).
      // Surface it so the client doesn't silently get "[DONE]".
      if (parsed.error) {
        const msg =
          typeof parsed.error === "string"
            ? parsed.error
            : parsed.error.message || "Upstream stream error";
        throw new Error(`Custom model upstream error: ${msg}`);
      }
      const delta = parsed.choices?.[0]?.delta;
      if (!delta) return;

      // OpenAI canonical: `content` is a string. Newer multimodal /
      // tool-calling streams may emit an array of `{type, text}` parts.
      // Older "compatible" servers (LM Studio, Ollama OpenAI gateway,
      // etc.) sometimes emit `reasoning_content` alongside or instead.
      // Normalise all three into plain text we forward to the client.
      let text = "";
      if (typeof delta.content === "string") {
        text = delta.content;
      } else if (Array.isArray(delta.content)) {
        for (const part of delta.content) {
          if (part && typeof part.text === "string") text += part.text;
        }
      }
      if (typeof delta.reasoning_content === "string") {
        // Reasoning chunks are merged inline with content so users see
        // the model's thinking even if the provider sends it separately.
        text += delta.reasoning_content;
      }
      if (!text) return;
      await writer.write(
        encoder.encode(`data: ${JSON.stringify({ text })}\n\n`),
      );
    };

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += value;
      if (buffer.length > SSE_BUFFER_MAX) {
        throw new Error(`SSE buffer exceeded ${SSE_BUFFER_MAX} bytes`);
      }
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith("data:")) continue;
        const payload = trimmed.slice(5).trim();
        await forwardEvent(payload);
      }
    }

    // Flush any trailing buffered line. Some servers (Cloudflare AI
    // Workers, Together, Groq) close the connection without a final
    // newline, which used to drop the last token of every completion.
    const tail = buffer.trim();
    if (tail.startsWith("data:")) {
      await forwardEvent(tail.slice(5).trim());
    }

    await writer.write(encoder.encode("data: [DONE]\n\n"));
  } catch (error: unknown) {
    const errPayload =
      error instanceof Error
        ? { error: error.message }
        : { error: String(error) };
    try {
      await writer.write(
        encoder.encode(`data: ${JSON.stringify(errPayload)}\n\n`),
      );
    } catch {
      // Stream already closed
    }
  }
}
