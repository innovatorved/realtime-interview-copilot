/** /api/completion — multi-provider streaming LLM endpoint.
 *
 *  Validates input, picks the provider (Gemini via Cloudflare AI Gateway or
 *  an OpenAI-compatible custom endpoint), and streams SSE frames of
 *  `{ text }` or `{ error }` followed by `[DONE]`. The route owns response
 *  shape; provider modules own wire encoding for their respective APIs. */

import {
  getCachedConfig,
  getEffectiveModelParams,
} from "../config-cache";
import { validateOutboundUrl } from "../url-guard";
import {
  authErrorResponse,
  getAuthenticatedUser,
  isAuthed,
  type AuthedUser,
} from "../middleware/auth";
import { encoder, jsonResponse } from "../lib/http";
import {
  buildAskAiPrompt,
  buildPrompt,
  buildSummarizerPrompt,
} from "../lib/prompt";
import { recordUsage, startUsage } from "../usage";
import { getDb } from "../db";
import { consumeQuota } from "../services/quota.service";
import { recordSecurityEvent } from "../lib/security-log";
import type { Env } from "../env";
import {
  FLAGS,
  MAX_BG_CHARS,
  MAX_CHAT_MESSAGE_CHARS,
  MAX_MESSAGES_PER_REQUEST,
  MAX_PROMPT_CHARS,
  parseImageDataUrls,
  type CompletionRequestBody,
  type WireMessage,
} from "./completion-types";
import { streamGeminiCompletion } from "./completion-gemini";
import { streamOpenAICompatibleCompletion } from "./completion-openai";

export async function handleCompletion(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  // Completion calls cost real money (Gemini quota). Require an approved,
  // non-banned user — pending_approval / banned must not be able to burn
  // credits while the admin sorts them out.
  const authResult = await getAuthenticatedUser(request, env, ctx);
  if (!isAuthed(authResult)) return authErrorResponse(authResult.error);
  const trackedUser: AuthedUser = authResult;

  let payload: CompletionRequestBody;
  try {
    payload = (await request.json()) as CompletionRequestBody;
  } catch (error) {
    return jsonResponse({ error: "Invalid JSON payload" }, 400);
  }

  if (payload === null || typeof payload !== "object") {
    return jsonResponse({ error: "Invalid payload" }, 400);
  }

  const hasChatHistory =
    Array.isArray(payload.messages) && payload.messages.length > 0;

  const validationError = validateChatMessages(payload, hasChatHistory);
  if (validationError) return validationError;

  const basePrompt = hasChatHistory
    ? payload.messages![payload.messages!.length - 1].text.trim()
    : typeof payload.prompt === "string"
      ? payload.prompt.trim()
      : "";
  if (!basePrompt) {
    return jsonResponse({ error: "prompt is required" }, 400);
  }
  if (basePrompt.length > MAX_PROMPT_CHARS) {
    return jsonResponse(
      { error: `prompt exceeds ${MAX_PROMPT_CHARS} characters` },
      413,
    );
  }

  if (payload.bg !== undefined) {
    if (typeof payload.bg !== "string") {
      return jsonResponse({ error: "bg must be a string" }, 400);
    }
    if (payload.bg.length > MAX_BG_CHARS) {
      return jsonResponse(
        { error: `bg exceeds ${MAX_BG_CHARS} characters` },
        413,
      );
    }
  }

  if (payload.flag !== undefined && typeof payload.flag !== "string") {
    return jsonResponse({ error: "flag must be a string" }, 400);
  }
  if (payload.image !== undefined) {
    if (typeof payload.image === "string") {
      // single data URL — fine
    } else if (Array.isArray(payload.image)) {
      if (!payload.image.every((v) => typeof v === "string")) {
        return jsonResponse(
          { error: "image array entries must be string data URLs" },
          400,
        );
      }
    } else {
      return jsonResponse(
        { error: "image must be a string data URL or array of them" },
        400,
      );
    }
  }

  // Per-user rate limit. Binding may be absent in local dev — fall open
  // only in that case. When the binding is present but throws, fail
  // closed so we cannot be abused.
  if (env.COMPLETION_LIMITER) {
    try {
      const { success } = await env.COMPLETION_LIMITER.limit({
        key: trackedUser.id,
      });
      if (!success) {
        recordUsage(env, ctx, request, trackedUser, "completion", {
          status: "rate_limited",
          errorCode: "429",
          flag: typeof payload.flag === "string" ? payload.flag : null,
          promptChars: basePrompt.length,
        });
        return jsonResponse(
          { error: "Rate limit exceeded. Try again in a minute." },
          429,
        );
      }
    } catch (err) {
      console.warn("[Worker] rate limiter threw, failing closed:", err);
      return jsonResponse({ error: "Rate limiter unavailable" }, 503);
    }
  }

  const wireMessages = buildWireMessages(payload, hasChatHistory, basePrompt);

  const promptChars = wireMessages.reduce((sum, m) => sum + m.text.length, 0);
  const totalImages = wireMessages.reduce(
    (sum, m) => sum + m.images.length,
    0,
  );

  const cfg = await getCachedConfig(env);

  // When an admin-configured custom base URL is in use, reject the request
  // up-front if the URL targets internal / link-local / loopback hosts. This
  // blocks SSRF via the admin dashboard even if an attacker gained admin.
  if (cfg.useCustom) {
    const check = validateOutboundUrl(cfg.customBaseUrl);
    if (!check.ok) {
      console.warn("[Worker] refused custom base URL:", check.reason);
      ctx.waitUntil(
        recordSecurityEvent(getDb(env), {
          eventType: "ssrf_blocked",
          action: "custom_model_url",
          ipAddress: request.headers.get("CF-Connecting-IP"),
          userEmail: trackedUser.email,
          metadata: { reason: check.reason },
        }),
      );
      return jsonResponse(
        { error: "Custom model base URL is not permitted" },
        400,
      );
    }
  }

  const stream = new TransformStream();
  const writer = stream.writable.getWriter();

  // Track response size by wrapping the writer. The streaming helpers emit
  // SSE frames like `data: {"text":"..."}` — we count the inner text chars
  // (not the SSE envelope) so the stored `responseChars` matches the text the
  // user actually sees.
  let responseChars = 0;
  let streamError: string | null = null;
  const activeModel = cfg.useCustom ? cfg.customModelName : cfg.geminiModel;
  const tracker = startUsage(env, ctx, request, trackedUser, "completion", {
    flag: typeof payload.flag === "string" ? payload.flag : null,
    model: activeModel,
    promptChars,
    metadata: {
      hasImage: totalImages > 0,
      imageCount: totalImages,
      useCustomModel: cfg.useCustom,
      chatTurns: hasChatHistory ? wireMessages.length : null,
    },
  });

  const trackingWriter: WritableStreamDefaultWriter<Uint8Array> = {
    write: (chunk: Uint8Array) => {
      try {
        const s = new TextDecoder().decode(chunk);
        const re = /data:\s*(\{[\s\S]*?\})\s*\n\n/g;
        let m: RegExpExecArray | null;
        while ((m = re.exec(s)) !== null) {
          try {
            const parsed = JSON.parse(m[1]);
            if (typeof parsed.text === "string")
              responseChars += parsed.text.length;
            if (typeof parsed.error === "string")
              streamError = parsed.error.slice(0, 200);
          } catch {
            /* ignore */
          }
        }
      } catch {
        /* never block on analytics */
      }
      return writer.write(chunk);
    },
    close: () => writer.close(),
    abort: (reason?: unknown) => writer.abort(reason),
    releaseLock: () => writer.releaseLock(),
    get closed() {
      return writer.closed;
    },
    get desiredSize() {
      return writer.desiredSize;
    },
    get ready() {
      return writer.ready;
    },
  } as WritableStreamDefaultWriter<Uint8Array>;

  const modelParams = await getEffectiveModelParams(
    env,
    trackedUser?.id ?? null,
  );

  const completionFn = cfg.useCustom
    ? streamOpenAICompatibleCompletion(
        wireMessages,
        cfg.customModelName,
        cfg.customApiKey,
        cfg.customBaseUrl,
        trackingWriter,
        modelParams,
      )
    : streamGeminiCompletion(
        wireMessages,
        cfg.geminiModel,
        cfg.geminiKey,
        cfg.cfAccountId,
        cfg.cfGatewayId,
        trackingWriter,
        modelParams,
        trackedUser,
      );

  const pump = completionFn
    .catch(async (error: unknown) => {
      const message =
        error instanceof Error
          ? { error: error.message }
          : { error: String(error) };
      streamError =
        typeof message.error === "string"
          ? message.error.slice(0, 200)
          : "error";
      await writer.write(
        encoder.encode(`data: ${JSON.stringify(message)}\n\n`),
      );
    })
    .finally(async () => {
      try {
        const status = streamError ? "error" : "ok";
        tracker.finish({
          status,
          errorCode: streamError ?? null,
          responseChars,
          model: activeModel,
        });
        if (status === "ok") {
          ctx.waitUntil(
            consumeQuota(getDb(env), env, trackedUser.id, "completion", {
              completions: 1,
            }),
          );
        }
      } catch {
        /* never throw from tracker */
      }
      await writer.close();
    });

  ctx.waitUntil(pump);

  return new Response(stream.readable, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}

function validateChatMessages(
  payload: CompletionRequestBody,
  hasChatHistory: boolean,
): Response | null {
  if (!hasChatHistory) return null;

  if (payload.messages!.length > MAX_MESSAGES_PER_REQUEST) {
    return jsonResponse(
      {
        error: `messages exceeds ${MAX_MESSAGES_PER_REQUEST} entries — drop older turns before sending`,
      },
      413,
    );
  }
  for (const m of payload.messages!) {
    if (!m || typeof m !== "object") {
      return jsonResponse(
        { error: "each message must be an object" },
        400,
      );
    }
    if (m.role !== "user" && m.role !== "assistant") {
      return jsonResponse(
        { error: 'message.role must be "user" or "assistant"' },
        400,
      );
    }
    if (typeof m.text !== "string") {
      return jsonResponse({ error: "message.text must be a string" }, 400);
    }
    if (m.text.length > MAX_CHAT_MESSAGE_CHARS) {
      return jsonResponse(
        {
          error: `message.text exceeds ${MAX_CHAT_MESSAGE_CHARS} characters`,
        },
        413,
      );
    }
    if (m.images !== undefined) {
      if (
        !Array.isArray(m.images) ||
        !m.images.every((v) => typeof v === "string")
      ) {
        return jsonResponse(
          { error: "message.images must be a string[] of data URLs" },
          400,
        );
      }
    }
  }
  // The final entry must be a user message — that's the question we're
  // answering. Allowing assistant-last would either replay an old reply
  // or produce a malformed model call.
  const last = payload.messages![payload.messages!.length - 1];
  if (last.role !== "user") {
    return jsonResponse(
      { error: "last messages[] entry must be from the user" },
      400,
    );
  }
  return null;
}

/** Build the WireMessage[] that the streaming helpers will turn into a
 *  Gemini `contents` / OpenAI `messages` payload.
 *
 *  The model only sees user/assistant turns (no separate system role),
 *  so the COPILOT flag's system instructions are folded into the FIRST
 *  user message's text. Doing it this way means:
 *    - Gemma family models (which reject system_instruction) still work.
 *    - Single-turn behaviour is byte-identical to the pre-chat code
 *      path — we just wrap one user message instead of zero.
 *    - In chat mode, only the very first user turn carries the system
 *      wrapper, so we don't repeat 1.5KB of instructions every turn. */
function buildWireMessages(
  payload: CompletionRequestBody,
  hasChatHistory: boolean,
  basePrompt: string,
): WireMessage[] {
  const wireMessages: WireMessage[] = [];
  if (hasChatHistory) {
    for (let i = 0; i < payload.messages!.length; i++) {
      const m = payload.messages![i];
      let text = m.text;
      if (i === 0 && m.role === "user" && payload.flag === FLAGS.COPILOT) {
        text = buildPrompt(payload.bg, text);
      } else if (
        i === 0 &&
        m.role === "user" &&
        payload.flag === FLAGS.ASK_AI
      ) {
        text = buildAskAiPrompt(payload.bg, text);
      }
      const msgImages = parseImageDataUrls(m.images);
      wireMessages.push({ role: m.role, text, images: msgImages });
    }
  } else {
    let text = basePrompt;
    if (payload.flag === FLAGS.COPILOT) {
      text = buildPrompt(payload.bg, basePrompt);
    } else if (payload.flag === FLAGS.ASK_AI) {
      text = buildAskAiPrompt(payload.bg, basePrompt);
    } else if (payload.flag === FLAGS.SUMMARIZER) {
      text = buildSummarizerPrompt(basePrompt);
    }
    const msgImages = parseImageDataUrls(payload.image);
    wireMessages.push({ role: "user", text, images: msgImages });
  }
  return wireMessages;
}
