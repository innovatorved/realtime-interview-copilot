/** Gemini (via Cloudflare AI Gateway) streaming completion provider. */

import { fetchWithRetry } from "../lib/fetch-retry";
import { encoder } from "../lib/http";
import type { ModelParams } from "../config-cache";
import type { AuthedUser } from "../middleware/auth";
import { SSE_BUFFER_MAX, type WireMessage } from "./completion-types";

const badFinishReasons = [
  "SAFETY",
  "RECITATION",
  "LANGUAGE",
  "BLOCKLIST",
  "PROHIBITED_CONTENT",
  "SPII",
  "MALFORMED_FUNCTION_CALL",
];

export async function streamGeminiCompletion(
  messages: WireMessage[],
  modelName: string,
  apiKey: string,
  cfAccountId: string,
  cfGatewayId: string,
  writer: WritableStreamDefaultWriter<Uint8Array>,
  params: ModelParams,
  trackedUser?: AuthedUser | null,
) {
  if (!apiKey) {
    throw new Error(
      "Missing Gemini API key — set via Admin Dashboard or GOOGLE_GENERATIVE_AI_API_KEY env var",
    );
  }
  if (messages.length === 0) {
    throw new Error("streamGeminiCompletion: messages[] is empty");
  }

  // Use header-based auth (x-goog-api-key) rather than ?key= so the API key
  // never shows up in URLs, access logs, or Referer headers on errors.
  const url = `https://gateway.ai.cloudflare.com/v1/${cfAccountId}/${cfGatewayId}/google-ai-studio/v1beta/models/${modelName}:streamGenerateContent?alt=sse`;

  // Map our wire-format messages → Gemini `contents`. Gemini wants
  // role: "user" | "model" (not "assistant"). Each content's `parts`
  // is image(s) THEN text — image-first ordering tells the model the
  // text references the preceding image.
  const contents: Array<Record<string, unknown>> = messages.map((m) => {
    const parts: Array<Record<string, unknown>> = [];
    for (const image of m.images) {
      parts.push({
        inlineData: {
          mimeType: image.mimeType,
          data: image.base64,
        },
      });
    }
    parts.push({ text: m.text });
    return { role: m.role === "assistant" ? "model" : "user", parts };
  });

  // Admin-configurable generation parameters. Thinking budget is mapped
  // per model family (each family accepts a different key/value shape):
  //   - Gemini 2.5 family  → thinkingBudget: integer token cap
  //   - Gemini 3 family    → thinkingLevel: "low" | "medium" | "high"
  //   - Gemma 4 family     → thinkingLevel: "MINIMAL" | "HIGH" (only these are valid)
  //   - Older aliases (gemini-1.5-*, gemini-flash-lite-latest, gemma-2/3) do
  //     not accept thinkingConfig at all — sending it returns HTTP 400.
  // https://ai.google.dev/gemini-api/docs/thinking
  const generationConfig: Record<string, unknown> = {
    maxOutputTokens: params.maxOutputTokens,
    temperature: params.temperature,
    topP: params.topP,
  };
  const budget = params.thinkingBudget;
  if (/^gemini-2\.5-/i.test(modelName)) {
    const map25: Record<typeof budget, number> = {
      off: 0,
      low: 1024,
      medium: 4096,
      high: 16384,
    };
    generationConfig.thinkingConfig = { thinkingBudget: map25[budget] };
  } else if (/^gemini-3/i.test(modelName)) {
    const map3: Record<typeof budget, string> = {
      off: "low",
      low: "low",
      medium: "medium",
      high: "high",
    };
    generationConfig.thinkingConfig = { thinkingLevel: map3[budget] };
  } else if (/^gemma-4-/i.test(modelName)) {
    const mapG4: Record<typeof budget, string> = {
      off: "MINIMAL",
      low: "MINIMAL",
      medium: "HIGH",
      high: "HIGH",
    };
    generationConfig.thinkingConfig = { thinkingLevel: mapG4[budget] };
  }

  const requestBody = JSON.stringify({
    contents,
    generationConfig,
  });

  try {
    // Tag the call with an opaque user id only, so AI Gateway logs are
    // attributable on our side without leaking PII (email/name) to a
    // third party. We resolve email→id locally in the admin filter.
    const aigHeaders: Record<string, string> = {
      "Content-Type": "application/json",
      "x-goog-api-key": apiKey,
    };
    if (trackedUser?.id) {
      const meta = { user_id: trackedUser.id.slice(0, 64) };
      const headerVal = JSON.stringify(meta);
      if (headerVal.length <= 1024) {
        aigHeaders["cf-aig-metadata"] = headerVal;
      }
    }

    const response = await fetchWithRetry(
      url,
      {
        method: "POST",
        headers: aigHeaders,
        body: requestBody,
      },
      // streaming: true → 10s only bounds time-to-first-byte; the body
      // can stream as long as Gemini needs. Without it long completions
      // were aborted mid-stream by the same AbortSignal that bounded
      // the headers fetch.
      { retries: 2, baseMs: 250, timeoutMs: 10_000, streaming: true },
    );

    if (!response.ok) {
      let errorBody = "Could not read error body";
      try {
        errorBody = await response.text();
      } catch {
        // Could not read error body
      }
      throw new Error(
        `API Error: ${response.status} ${response.statusText}. Body: ${errorBody}`,
      );
    }

    if (!response.body) {
      throw new Error("Response body is null");
    }

    const reader = response.body
      .pipeThrough(new TextDecoderStream())
      .getReader();

    let buffer = "";
    const SSERegex = /^data:\s*(.*)(?:\n\n|\r\r|\r\n\r\n)/;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += value;
      if (buffer.length > SSE_BUFFER_MAX) {
        throw new Error(`SSE buffer exceeded ${SSE_BUFFER_MAX} bytes`);
      }

      let match;
      while ((match = buffer.match(SSERegex)) !== null) {
        const jsonDataString = match[1];

        if (jsonDataString) {
          try {
            const jsonChunk = JSON.parse(jsonDataString);
            const text = extractTextFromChunk(jsonChunk);

            if (text !== null && text !== "") {
              const sseData = JSON.stringify({ text });
              await writer.write(encoder.encode(`data: ${sseData}\n\n`));
            }
          } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : String(e);
            const errorMessage = JSON.stringify({
              error: `JSON Parse Error: ${msg}`,
            });
            await writer.write(encoder.encode(`data: ${errorMessage}\n\n`));
          }
        }

        buffer = buffer.substring(match[0].length);
      }
    }

    await writer.write(encoder.encode("data: [DONE]\n\n"));
  } catch (error: unknown) {
    console.error(
      "Error streaming from Gemini API:",
      error instanceof Error ? error.message : "unknown",
    );
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

function extractTextFromChunk(chunk: any): string | null {
  if (!chunk) {
    return null;
  }

  const feedback = chunk.promptFeedback;
  if (feedback?.blockReason) {
    return `[PROMPT_BLOCKED: ${feedback.blockReason}]`;
  }

  const candidate = chunk.candidates?.[0];
  if (!candidate) {
    return null;
  }

  if (
    candidate.finishReason &&
    badFinishReasons.includes(candidate.finishReason)
  ) {
    return `[CANDIDATE_BLOCKED: ${candidate.finishReason}]`;
  }

  const parts = candidate.content?.parts;
  if (!Array.isArray(parts) || parts.length === 0) {
    return null;
  }

  let text = "";
  for (const part of parts) {
    // Skip any "thought" parts so the model's internal reasoning never leaks
    // into the user-facing stream, regardless of the thinkingConfig flag.
    if (part?.thought === true) continue;
    if (typeof part?.text === "string") {
      text += part.text;
    }
  }

  return text || null;
}
