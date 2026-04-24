import { auth, TRUSTED_ORIGINS as AUTH_TRUSTED_ORIGINS } from "./auth";
import { getDb } from "./db";
import { savedNote, interviewPreset, user as userTable } from "./db/schema";
import { eq, desc, like, or, and, sql, count } from "drizzle-orm";
import { getCachedConfig } from "./config-cache";
import { KV, KV_TTL_SECONDS } from "./kv-keys";
import { validateOutboundUrl } from "./url-guard";
import {
  startUsage,
  recordUsage,
  getUserUsageSummary,
  getUsageTimeseries,
} from "./usage";

// ─── Constants & Limits ─────────────────────────────────────────────────────

const MAX_PROMPT_CHARS = 32_000;
const MAX_BG_CHARS = 16_000;
const MAX_NOTE_CONTENT_CHARS = 50_000;
const MAX_NOTE_TAG_CHARS = 100;
const MAX_NOTE_IDS_PER_EXPORT = 500;
const DEEPGRAM_TIMEOUT_MS = 10_000;
const SSE_BUFFER_MAX = 256 * 1024; // 256KB cap to avoid unbounded growth.

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}


enum FLAGS {
  COPILOT = "copilot",
  SUMMARIZER = "summarizer",
}

interface Env {
  DEEPGRAM_API_KEY: string;
  GOOGLE_GENERATIVE_AI_API_KEY: string;
  GEMINI_MODEL?: string;
  BETTER_AUTH_SECRET: string;
  BETTER_AUTH_URL: string;
  /** Comma-separated emails allowed to use /api/admin/* (self-hosted dashboard). */
  ADMIN_EMAILS?: string;
  /** Cloudflare account id that owns the AI Gateway (fallback when not set via admin dashboard). */
  CF_ACCOUNT_ID?: string;
  /** Cloudflare AI Gateway id (fallback when not set via admin dashboard). */
  CF_GATEWAY_ID?: string;
  /** Cloudflare API token with AI Gateway read scope (fallback when not set via admin dashboard). */
  CF_API_TOKEN?: string;
  DB: D1Database;
  /** General-purpose KV namespace for the worker (see src/kv-keys.ts). */
  CONFIG_KV?: KVNamespace;
  /** Cloudflare built-in rate limiter for /api/completion. */
  COMPLETION_LIMITER?: {
    limit: (opts: { key: string }) => Promise<{ success: boolean }>;
  };
}

interface CompletionRequestBody {
  bg?: string;
  flag?: string;
  prompt?: string;
  /** Optional image attached to the prompt as a data URL (e.g. data:image/png;base64,...). */
  image?: string;
}

interface InlineImage {
  mimeType: string;
  base64: string;
}

function parseImageDataUrl(input: string | undefined): InlineImage | null {
  if (!input) return null;
  const match = /^data:([^;]+);base64,(.+)$/.exec(input.trim());
  if (!match) return null;
  const mime = match[1];
  const data = match[2];
  if (!/^image\/(png|jpeg|jpg|webp|gif)$/i.test(mime)) return null;
  if (data.length > (8 * 1024 * 1024 * 4) / 3) return null;
  return { mimeType: mime, base64: data };
}

const jsonHeaders = {
  "content-type": "application/json",
};

const encoder = new TextEncoder();

const ALLOWED_METHODS = "GET,POST,PUT,DELETE,OPTIONS";
const ALLOWED_HEADERS = "Content-Type,Authorization";
const CORS_MAX_AGE = "86400";

// Single source of truth for allowed origins, re-exported to Better Auth so
// CORS and the auth trusted-origin check never drift (previously the prod
// copilot domain was missing from Better Auth's allowlist).
const TRUSTED_ORIGINS: ReadonlySet<string> = new Set<string>(AUTH_TRUSTED_ORIGINS);

function buildCorsHeaders(request: Request) {
  const origin = request.headers.get("Origin");
  const allowOrigin =
    origin && TRUSTED_ORIGINS.has(origin)
      ? origin
      : (TRUSTED_ORIGINS.values().next().value as string);

  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Methods": ALLOWED_METHODS,
    "Access-Control-Allow-Headers": ALLOWED_HEADERS,
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Max-Age": CORS_MAX_AGE,
    Vary: "Origin",
  } satisfies Record<string, string>;
}

function withCors(response: Response, request: Request): Response {
  const corsHeaders = buildCorsHeaders(request);
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(corsHeaders)) {
    headers.set(key, value);
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function handleOptions(request: Request): Response {
  const headers = buildCorsHeaders(request);
  return new Response(null, {
    status: 200,
    headers,
  });
}

function getClientIp(request: Request): string {
  return (
    request.headers.get("cf-connecting-ip") ??
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    "unknown"
  );
}

type AuthFailureReason = "unauthorized" | "pending_approval" | "banned";

interface AuthedUser {
  id: string;
  email: string;
  name: string;
}

async function getAuthenticatedUser(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
): Promise<AuthedUser | { error: AuthFailureReason }> {
  let session;
  try {
    session = await auth(env).api.getSession({ headers: request.headers });
  } catch (e) {
    // Distinguish internal errors from "no session" so operators get a signal
    // but the caller still sees 401 (the safe default).
    console.warn("[Worker] getSession failed:", e);
    return { error: "unauthorized" };
  }
  if (!session?.user) return { error: "unauthorized" };

  const userId = session.user.id;

  // Load approval / ban flags every request so revocations take effect
  // immediately (sessions are not invalidated when an admin bans a user).
  let flags: { isApproved: boolean | null; isBanned: boolean | null } | null = null;
  try {
    const rows = await getDb(env)
      .select({ isApproved: userTable.isApproved, isBanned: userTable.isBanned })
      .from(userTable)
      .where(eq(userTable.id, userId))
      .limit(1);
    flags = rows[0] ?? null;
  } catch (e) {
    console.warn("[Worker] flag lookup failed:", e);
    return { error: "unauthorized" };
  }

  if (flags?.isBanned === true) return { error: "banned" };
  if (flags?.isApproved !== true) return { error: "pending_approval" };

  // KV-backed throttle so lastActiveAt writes happen at most every 5 minutes
  // per user, consistent across isolates.
  if (env.CONFIG_KV) {
    const key = KV.userActivity(userId);
    const seen = await env.CONFIG_KV.get(key).catch(() => null);
    if (!seen) {
      ctx.waitUntil(
        (async () => {
          try {
            await env.CONFIG_KV!.put(key, "1", {
              expirationTtl: KV_TTL_SECONDS.userActivity,
            });
            await getDb(env)
              .update(userTable)
              .set({ lastActiveAt: new Date() })
              .where(eq(userTable.id, userId))
              .execute();
          } catch (e) {
            console.warn("[Worker] activity update failed:", e);
          }
        })(),
      );
    }
  }

  return {
    id: userId,
    email: session.user.email,
    name: session.user.name,
  };
}

function authErrorResponse(reason: AuthFailureReason): Response {
  switch (reason) {
    case "banned":
      return jsonResponse({ error: "Account suspended" }, 403);
    case "pending_approval":
      return jsonResponse({ error: "Account pending approval" }, 403);
    case "unauthorized":
    default:
      return jsonResponse({ error: "Unauthorized" }, 401);
  }
}

function isAuthed(result: AuthedUser | { error: AuthFailureReason }): result is AuthedUser {
  return !("error" in result);
}

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: jsonHeaders });
}

function buildPrompt(bg: string | undefined, conversation: string) {
  return `You are an expert interview assistant designed to help the candidate succeed. Your goal is to generate a comprehensive, structured, and natural-sounding response that the candidate can confidently speak during the interview.

**Instructions:**
1.  **Analyze the Context:** Use the provided background information and conversation history to understand the interviewer's question and the current topic.
2.  **Structure the Response:**
    *   **Direct Answer:** Start with a clear, direct answer to the question.
    *   **Key Points:** Provide 3-5 detailed bullet points explaining the concept, methodology, or reasoning. Use professional terminology but keep the explanations accessible.
    *   **Example/Experience:** If applicable, briefly suggest a relevant example or a way to tie this back to practical experience.
3.  **Tone & Style:**
    *   Professional, confident, and articulate.
    *   "Speakable": Write in a way that sounds natural when spoken aloud. Avoid overly complex sentence structures or unpronounceable jargon unless standard in the field.
    *   Avoid meta-commentary (e.g., "Here is a response..."). Just provide the content.
4.  **Detail Level:** Be detailed and sufficient. Do not be brief unless the question demands a simple yes/no. Ensure the candidate has enough material to speak for 1-2 minutes if needed.

**Input Data:**
--------------------------------
BACKGROUND:
${bg}
--------------------------------
CONVERSATION:
${conversation}
--------------------------------

**Response:**`;
}

function buildSummarizerPrompt(text: string) {
  return `Summarize the following text concisely. Only write the summary.\nContent:\n${text}\nSummary:\n`;
}

type DeepgramProjectsResponse = {
  projects: Array<{ project_id: string }>;
};

type DeepgramKeyResponse = Record<string, unknown> & {
  error?: unknown;
};

const badFinishReasons = [
  "SAFETY",
  "RECITATION",
  "LANGUAGE",
  "BLOCKLIST",
  "PROHIBITED_CONTENT",
  "SPII",
  "MALFORMED_FUNCTION_CALL",
];

// ─── Retry helper ────────────────────────────────────────────────────────────

const RETRYABLE_STATUS = new Set([429, 502, 503, 504]);

/**
 * Issue an HTTP request with bounded retries for transient upstream failures.
 * Only the initial request (headers + connection) is retried — once the body
 * has started streaming we hand control to the caller.
 */
async function fetchWithRetry(
  url: string,
  init: RequestInit,
  opts: { retries: number; baseMs: number; timeoutMs: number },
): Promise<Response> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= opts.retries; attempt++) {
    const signal = AbortSignal.timeout(opts.timeoutMs);
    try {
      const resp = await fetch(url, { ...init, signal });
      if (resp.ok || !RETRYABLE_STATUS.has(resp.status) || attempt === opts.retries) {
        return resp;
      }
      // Drain body so the connection can be reused, then back off.
      try { await resp.body?.cancel(); } catch { /* ignore */ }
      lastErr = new Error(`upstream ${resp.status}`);
    } catch (err) {
      lastErr = err;
      if (attempt === opts.retries) throw err;
    }
    const delay = opts.baseMs * Math.pow(2, attempt) + Math.floor(Math.random() * 100);
    await new Promise((r) => setTimeout(r, delay));
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

// ─── Fetch handler ───────────────────────────────────────────────────────────

export default {
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/$/, "");

    if (request.method === "OPTIONS") {
      return handleOptions(request);
    }

    if (
      (request.method === "POST" || request.method === "GET") &&
      (path === "/api/deepgram" || path === "/deepgram")
    ) {
      const response = await handleDeepgram(request, env, ctx);
      return withCors(response, request);
    }

    if (
      request.method === "POST" &&
      (path === "/api/completion" || path === "/completion")
    ) {
      const response = await handleCompletion(request, env, ctx);
      return withCors(response, request);
    }

    if (path === "/api/notes" && request.method === "GET") {
      const response = await handleGetNotes(request, env, ctx, url);
      return withCors(response, request);
    }
    if (path === "/api/notes" && request.method === "POST") {
      const response = await handleCreateNote(request, env, ctx);
      return withCors(response, request);
    }
    if (path.match(/^\/api\/notes\/[^/]+$/) && request.method === "DELETE") {
      const noteId = path.split("/").pop()!;
      const response = await handleDeleteNote(request, env, ctx, noteId);
      return withCors(response, request);
    }

    if (path === "/api/presets" && request.method === "GET") {
      const response = await handleGetPresets(request, env, ctx);
      return withCors(response, request);
    }

    if (path === "/api/export" && request.method === "POST") {
      const response = await handleExport(request, env, ctx);
      return withCors(response, request);
    }

    if (path === "/api/usage/me" && request.method === "GET") {
      const response = await handleUsageMe(request, env, ctx, url);
      return withCors(response, request);
    }

    if (path.startsWith("/api/auth")) {
      try {
        const response = await auth(env).handler(request);
        return withCors(response, request);
      } catch (e) {
        console.error("[Worker] Auth error:", e instanceof Error ? e.message : "unknown");
        return withCors(
          jsonResponse({ error: "Authentication error" }, 500),
          request,
        );
      }
    }

    return withCors(jsonResponse({ error: "Not found" }, 404), request);
  },
};

async function handleDeepgram(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  // Require authentication so the project's paid Deepgram key is never minted
  // for anonymous callers.
  const authResult = await getAuthenticatedUser(request, env, ctx);
  if (!isAuthed(authResult)) return authErrorResponse(authResult.error);

  // Per-user rate limit. Use COMPLETION_LIMITER binding when available; fail
  // closed when the binding throws (except when the binding itself is absent
  // in local dev — there we intentionally fall open so the loopback works).
  if (env.COMPLETION_LIMITER) {
    const key = `deepgram:${authResult.id}`;
    try {
      const { success } = await env.COMPLETION_LIMITER.limit({ key });
      if (!success) {
        recordUsage(env, ctx, request, authResult, "deepgram_key", {
          status: "rate_limited",
          errorCode: "429",
        });
        return jsonResponse({ error: "Rate limit exceeded. Try again in a minute." }, 429);
      }
    } catch (err) {
      console.warn("[Worker] deepgram rate limiter threw, failing closed:", err);
      return jsonResponse({ error: "Rate limiter unavailable" }, 503);
    }
  }

  const tracker = startUsage(env, ctx, request, authResult, "deepgram_key");

  const cfg = await getCachedConfig(env);
  const apiKey = cfg.deepgramKey;

  if (!apiKey) {
    tracker.finish({ status: "error", errorCode: "missing_key" });
    return jsonResponse(
      { error: "Missing Deepgram API key — set via Admin Dashboard or DEEPGRAM_API_KEY env var" },
      500,
    );
  }

  const authHeaders = {
    Authorization: `Token ${apiKey}`,
    accept: "application/json",
  };

  try {
    const projectsResponse = await fetch("https://api.deepgram.com/v1/projects", {
      method: "GET",
      headers: authHeaders,
      signal: AbortSignal.timeout(DEEPGRAM_TIMEOUT_MS),
    });

    const projectsBody = (await projectsResponse.json()) as DeepgramProjectsResponse;

    if (!projectsResponse.ok) {
      tracker.finish({ status: "error", errorCode: String(projectsResponse.status) });
      return new Response(JSON.stringify(projectsBody), {
        status: projectsResponse.status,
        headers: jsonHeaders,
      });
    }

    const project = projectsBody.projects?.[0];

    if (!project) {
      tracker.finish({ status: "error", errorCode: "no_project" });
      return jsonResponse(
        { error: "Cannot find a Deepgram project. Please create a project first." },
        404,
      );
    }

    const createResponse = await fetch(
      `https://api.deepgram.com/v1/projects/${project.project_id}/keys`,
      {
        method: "POST",
        headers: {
          ...authHeaders,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          comment: `Temporary API key (user ${authResult.id})`,
          scopes: ["usage:write"],
          tags: ["cloudflare-worker", `user:${authResult.id}`],
          time_to_live_in_seconds: 60,
        }),
        signal: AbortSignal.timeout(DEEPGRAM_TIMEOUT_MS),
      },
    );

    const createBody = (await createResponse.json()) as DeepgramKeyResponse;

    tracker.finish({
      status: createResponse.ok ? "ok" : "error",
      errorCode: createResponse.ok ? null : String(createResponse.status),
    });

    return new Response(JSON.stringify(createBody), {
      status: createResponse.ok ? 200 : createResponse.status,
      headers: jsonHeaders,
    });
  } catch (err) {
    console.warn("[Worker] deepgram upstream failed:", err);
    tracker.finish({ status: "error", errorCode: "upstream_timeout" });
    return jsonResponse({ error: "Upstream timeout or error talking to Deepgram" }, 504);
  }
}

async function handleCompletion(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  // Resolve the caller up-front so we can attribute usage. Completion is
  // intentionally lenient (anonymous callers are still rate-limited by IP),
  // so we only record the user when a session is present.
  let trackedUser: AuthedUser | null = null;
  try {
    const maybe = await getAuthenticatedUser(request, env, ctx);
    if (isAuthed(maybe)) trackedUser = maybe;
  } catch {
    trackedUser = null;
  }

  let payload: CompletionRequestBody;
  try {
    payload = (await request.json()) as CompletionRequestBody;
  } catch (error) {
    return jsonResponse({ error: "Invalid JSON payload" }, 400);
  }

  if (payload === null || typeof payload !== "object") {
    return jsonResponse({ error: "Invalid payload" }, 400);
  }

  const basePrompt = typeof payload.prompt === "string" ? payload.prompt.trim() : "";
  if (!basePrompt) {
    return jsonResponse({ error: "prompt is required" }, 400);
  }
  if (basePrompt.length > MAX_PROMPT_CHARS) {
    return jsonResponse({ error: `prompt exceeds ${MAX_PROMPT_CHARS} characters` }, 413);
  }

  if (payload.bg !== undefined) {
    if (typeof payload.bg !== "string") {
      return jsonResponse({ error: "bg must be a string" }, 400);
    }
    if (payload.bg.length > MAX_BG_CHARS) {
      return jsonResponse({ error: `bg exceeds ${MAX_BG_CHARS} characters` }, 413);
    }
  }

  if (payload.flag !== undefined && typeof payload.flag !== "string") {
    return jsonResponse({ error: "flag must be a string" }, 400);
  }
  if (payload.image !== undefined && typeof payload.image !== "string") {
    return jsonResponse({ error: "image must be a string data URL" }, 400);
  }

  // Rate limit: keyed by user id when authenticated, else client IP. Binding
  // may be absent in local dev — fall open only in that case. When the
  // binding is present but throws, fail closed so we cannot be abused.
  if (env.COMPLETION_LIMITER) {
    const key = trackedUser?.id ?? `ip:${getClientIp(request)}`;
    try {
      const { success } = await env.COMPLETION_LIMITER.limit({ key });
      if (!success) {
        recordUsage(env, ctx, request, trackedUser, "completion", {
          status: "rate_limited",
          errorCode: "429",
          flag: typeof payload.flag === "string" ? payload.flag : null,
          promptChars: basePrompt.length,
        });
        return jsonResponse({ error: "Rate limit exceeded. Try again in a minute." }, 429);
      }
    } catch (err) {
      console.warn("[Worker] rate limiter threw, failing closed:", err);
      return jsonResponse({ error: "Rate limiter unavailable" }, 503);
    }
  }

  let finalPrompt = basePrompt;
  if (payload.flag === FLAGS.COPILOT) {
    finalPrompt = buildPrompt(payload.bg, basePrompt);
  } else if (payload.flag === FLAGS.SUMMARIZER) {
    finalPrompt = buildSummarizerPrompt(basePrompt);
  }

  const image = parseImageDataUrl(payload.image);

  const cfg = await getCachedConfig(env);

  // When an admin-configured custom base URL is in use, reject the request
  // up-front if the URL targets internal / link-local / loopback hosts. This
  // blocks SSRF via the admin dashboard even if an attacker gained admin.
  if (cfg.useCustom) {
    const check = validateOutboundUrl(cfg.customBaseUrl);
    if (!check.ok) {
      console.warn("[Worker] refused custom base URL:", check.reason);
      return jsonResponse({ error: "Custom model base URL is not permitted" }, 400);
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
    promptChars: finalPrompt.length,
    metadata: {
      hasImage: Boolean(image),
      useCustomModel: cfg.useCustom,
    },
  });

  const trackingWriter: WritableStreamDefaultWriter<Uint8Array> = {
    // Proxy subset used by the streaming helpers.
    write: (chunk: Uint8Array) => {
      try {
        const s = new TextDecoder().decode(chunk);
        // Parse any `data: {...}` payloads present in the chunk to extract
        // text / error counts. Best-effort — malformed chunks are ignored.
        const re = /data:\s*(\{[\s\S]*?\})\s*\n\n/g;
        let m: RegExpExecArray | null;
        while ((m = re.exec(s)) !== null) {
          try {
            const parsed = JSON.parse(m[1]);
            if (typeof parsed.text === "string") responseChars += parsed.text.length;
            if (typeof parsed.error === "string") streamError = parsed.error.slice(0, 200);
          } catch { /* ignore */ }
        }
      } catch { /* never block on analytics */ }
      return writer.write(chunk);
    },
    close: () => writer.close(),
    abort: (reason?: unknown) => writer.abort(reason),
    releaseLock: () => writer.releaseLock(),
    get closed() { return writer.closed; },
    get desiredSize() { return writer.desiredSize; },
    get ready() { return writer.ready; },
  } as WritableStreamDefaultWriter<Uint8Array>;

  const completionFn = cfg.useCustom
    ? streamOpenAICompatibleCompletion(finalPrompt, cfg.customModelName, cfg.customApiKey, cfg.customBaseUrl, trackingWriter, image)
    : streamGeminiCompletion(finalPrompt, cfg.geminiModel, cfg.geminiKey, cfg.cfAccountId, cfg.cfGatewayId, trackingWriter, image);

  const pump = completionFn
    .catch(async (error: unknown) => {
      const message = error instanceof Error
        ? { error: error.message }
        : { error: String(error) };
      streamError = typeof message.error === "string" ? message.error.slice(0, 200) : "error";
      await writer.write(encoder.encode(`data: ${JSON.stringify(message)}\n\n`));
    })
    .finally(async () => {
      try {
        tracker.finish({
          status: streamError ? "error" : "ok",
          errorCode: streamError ?? null,
          responseChars,
          model: activeModel,
        });
      } catch { /* never throw from tracker */ }
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

async function streamGeminiCompletion(
  prompt: string,
  modelName: string,
  apiKey: string,
  cfAccountId: string,
  cfGatewayId: string,
  writer: WritableStreamDefaultWriter<Uint8Array>,
  image?: InlineImage | null,
) {
  if (!apiKey) {
    throw new Error("Missing Gemini API key — set via Admin Dashboard or GOOGLE_GENERATIVE_AI_API_KEY env var");
  }

  // Use header-based auth (x-goog-api-key) rather than ?key= so the API key
  // never shows up in URLs, access logs, or Referer headers on errors.
  const url = `https://gateway.ai.cloudflare.com/v1/${cfAccountId}/${cfGatewayId}/google-ai-studio/v1beta/models/${modelName}:streamGenerateContent?alt=sse`;

  const parts: Array<Record<string, unknown>> = [];
  if (image) {
    parts.push({
      inlineData: {
        mimeType: image.mimeType,
        data: image.base64,
      },
    });
  }
  parts.push({ text: prompt });

  // Disable "thinking" / chain-of-thought on every family that supports it so
  // responses start immediately and no raw thoughts leak into the stream.
  //   - Gemini 2.5 family  → thinkingBudget: 0
  //   - Gemini 3 family    → thinkingLevel: "low"
  //   - Gemma 4 family     → thinkingLevel: "MINIMAL" (only MINIMAL|HIGH valid)
  //   - Older aliases (gemini-1.5-*, gemini-flash-lite-latest, gemma-2/3) do
  //     not accept thinkingConfig at all — sending it returns HTTP 400.
  // https://ai.google.dev/gemini-api/docs/thinking
  const generationConfig: Record<string, unknown> = {
    maxOutputTokens: 8192,
  };
  if (/^gemini-2\.5-/i.test(modelName)) {
    generationConfig.thinkingConfig = { thinkingBudget: 0 };
  } else if (/^gemini-3/i.test(modelName)) {
    generationConfig.thinkingConfig = { thinkingLevel: "low" };
  } else if (/^gemma-4-/i.test(modelName)) {
    generationConfig.thinkingConfig = { thinkingLevel: "MINIMAL" };
  }

  const requestBody = JSON.stringify({
    contents: [
      {
        parts,
        role: "user",
      },
    ],
    generationConfig,
  });

  try {
    const response = await fetchWithRetry(
      url,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": apiKey,
        },
        body: requestBody,
      },
      { retries: 2, baseMs: 250, timeoutMs: 10_000 },
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
            const errorMessage = JSON.stringify({ error: `JSON Parse Error: ${msg}` });
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
    const errPayload = error instanceof Error ? { error: error.message } : { error: String(error) };
    try {
      await writer.write(encoder.encode(`data: ${JSON.stringify(errPayload)}\n\n`));
    } catch {
      // Stream already closed
    }
  }
}

async function streamOpenAICompatibleCompletion(
  prompt: string,
  modelName: string,
  apiKey: string,
  baseUrl: string,
  writer: WritableStreamDefaultWriter<Uint8Array>,
  image?: InlineImage | null,
) {
  if (!apiKey || !baseUrl) {
    throw new Error("Missing custom model API key or base URL — configure in Admin Dashboard Settings");
  }

  const endpoint = baseUrl.replace(/\/+$/, "") + "/chat/completions";

  const content: Array<Record<string, unknown>> | string = image
    ? [
        { type: "text", text: prompt },
        {
          type: "image_url",
          image_url: {
            url: `data:${image.mimeType};base64,${image.base64}`,
          },
        },
      ]
    : prompt;

  const requestBody = JSON.stringify({
    model: modelName,
    stream: true,
    max_tokens: 8192,
    messages: [{ role: "user", content }],
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
      { retries: 2, baseMs: 250, timeoutMs: 10_000 },
    );

    if (!response.ok) {
      let errorBody = "Could not read error body";
      try { errorBody = await response.text(); } catch { /* ignore */ }
      throw new Error(`Custom model API error: ${response.status} ${response.statusText}. Body: ${errorBody}`);
    }

    if (!response.body) throw new Error("Response body is null");

    const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
    let buffer = "";

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
        if (payload === "[DONE]") continue;

        try {
          const parsed = JSON.parse(payload);
          const delta = parsed.choices?.[0]?.delta?.content;
          if (delta) {
            await writer.write(encoder.encode(`data: ${JSON.stringify({ text: delta })}\n\n`));
          }
        } catch { /* skip malformed chunks */ }
      }
    }

    await writer.write(encoder.encode("data: [DONE]\n\n"));
  } catch (error: unknown) {
    const errPayload = error instanceof Error ? { error: error.message } : { error: String(error) };
    try {
      await writer.write(encoder.encode(`data: ${JSON.stringify(errPayload)}\n\n`));
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

// ─── Notes CRUD ──────────────────────────────────────────────────────────────

async function handleGetNotes(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  url: URL,
): Promise<Response> {
  const auth = await getAuthenticatedUser(request, env, ctx);
  if (!isAuthed(auth)) return authErrorResponse(auth.error);
  const user = auth;

  const db = getDb(env);
  const page = Math.max(1, parseInt(url.searchParams.get("page") ?? "1", 10));
  const limit = Math.min(
    50,
    Math.max(1, parseInt(url.searchParams.get("limit") ?? "20", 10)),
  );
  const search = (url.searchParams.get("q") ?? "").trim();
  const tag = (url.searchParams.get("tag") ?? "").trim();
  const offset = (page - 1) * limit;

  const conditions = [eq(savedNote.userId, user.id)];
  if (search) {
    conditions.push(like(savedNote.content, `%${search}%`));
  }
  if (tag) {
    conditions.push(eq(savedNote.tag, tag));
  }

  const whereClause = conditions.length === 1 ? conditions[0] : and(...conditions);

  const [notes, totalResult] = await Promise.all([
    db
      .select()
      .from(savedNote)
      .where(whereClause)
      .orderBy(desc(savedNote.createdAt))
      .limit(limit)
      .offset(offset),
    db
      .select({ total: count() })
      .from(savedNote)
      .where(whereClause),
  ]);

  const total = totalResult[0]?.total ?? 0;

  recordUsage(env, ctx, request, user, "note_list", {
    metadata: { returned: notes.length, page, limit },
  });

  return jsonResponse({
    notes,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  });
}

async function handleCreateNote(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  const auth = await getAuthenticatedUser(request, env, ctx);
  if (!isAuthed(auth)) return authErrorResponse(auth.error);
  const user = auth;

  let body: { content?: unknown; tag?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return jsonResponse({ error: "Invalid JSON" }, 400);
  }

  if (body === null || typeof body !== "object") {
    return jsonResponse({ error: "Invalid body" }, 400);
  }

  const rawContent = typeof body.content === "string" ? body.content : "";
  const content = rawContent.trim();
  if (!content) return jsonResponse({ error: "content is required" }, 400);
  if (content.length > MAX_NOTE_CONTENT_CHARS) {
    return jsonResponse({ error: `content exceeds ${MAX_NOTE_CONTENT_CHARS} characters` }, 413);
  }

  let tag = "Copilot";
  if (body.tag !== undefined) {
    if (typeof body.tag !== "string") {
      return jsonResponse({ error: "tag must be a string" }, 400);
    }
    const trimmed = body.tag.trim();
    if (trimmed.length === 0 || trimmed.length > MAX_NOTE_TAG_CHARS) {
      return jsonResponse({ error: `tag must be 1..${MAX_NOTE_TAG_CHARS} characters` }, 400);
    }
    tag = trimmed;
  }

  const db = getDb(env);
  const id = crypto.randomUUID();
  const now = new Date();

  const note = {
    id,
    userId: user.id,
    content,
    tag,
    createdAt: now,
  };

  await db.insert(savedNote).values(note);

  recordUsage(env, ctx, request, user, "note_create", {
    promptChars: content.length,
    metadata: { tag, noteId: id },
  });

  return jsonResponse({ note }, 201);
}

async function handleDeleteNote(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  noteId: string,
): Promise<Response> {
  const auth = await getAuthenticatedUser(request, env, ctx);
  if (!isAuthed(auth)) return authErrorResponse(auth.error);
  const user = auth;

  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(noteId)) {
    return jsonResponse({ error: "Invalid note id" }, 400);
  }

  const db = getDb(env);
  await db
    .delete(savedNote)
    .where(and(eq(savedNote.id, noteId), eq(savedNote.userId, user.id)));

  recordUsage(env, ctx, request, user, "note_delete", {
    metadata: { noteId },
  });

  return jsonResponse({ success: true });
}

// ─── Presets ─────────────────────────────────────────────────────────────────

async function handleGetPresets(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  const auth = await getAuthenticatedUser(request, env, ctx);
  if (!isAuthed(auth)) return authErrorResponse(auth.error);
  const user = auth;

  const db = getDb(env);
  const presets = await db
    .select()
    .from(interviewPreset)
    .where(
      or(
        eq(interviewPreset.isBuiltIn, true),
        eq(interviewPreset.userId, user.id),
      ),
    )
    .orderBy(interviewPreset.name);

  recordUsage(env, ctx, request, user, "preset_list", {
    metadata: { returned: presets.length },
  });

  return jsonResponse({ presets });
}

// ─── Export ──────────────────────────────────────────────────────────────────

interface ExportRequestBody {
  format: "markdown" | "pdf";
  noteIds?: string[];
}

async function handleExport(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  const auth = await getAuthenticatedUser(request, env, ctx);
  if (!isAuthed(auth)) return authErrorResponse(auth.error);
  const user = auth;

  let body: ExportRequestBody;
  try {
    body = (await request.json()) as ExportRequestBody;
  } catch {
    return jsonResponse({ error: "Invalid JSON" }, 400);
  }

  const format = body.format;
  if (format !== "markdown" && format !== "pdf") {
    return jsonResponse({ error: "format must be 'markdown' or 'pdf'" }, 400);
  }

  if (body.noteIds !== undefined) {
    if (!Array.isArray(body.noteIds)) {
      return jsonResponse({ error: "noteIds must be an array" }, 400);
    }
    if (body.noteIds.length > MAX_NOTE_IDS_PER_EXPORT) {
      return jsonResponse({ error: `noteIds must be <= ${MAX_NOTE_IDS_PER_EXPORT}` }, 400);
    }
    for (const id of body.noteIds) {
      if (typeof id !== "string" || !/^[a-zA-Z0-9_-]{1,128}$/.test(id)) {
        return jsonResponse({ error: "noteIds contains an invalid id" }, 400);
      }
    }
  }

  const db = getDb(env);

  let notes;
  if (body.noteIds && body.noteIds.length > 0) {
    notes = await db
      .select()
      .from(savedNote)
      .where(
        and(
          eq(savedNote.userId, user.id),
          sql`${savedNote.id} IN (${sql.join(
            body.noteIds.map((id) => sql`${id}`),
            sql`, `,
          )})`,
        ),
      )
      .orderBy(desc(savedNote.createdAt));
  } else {
    notes = await db
      .select()
      .from(savedNote)
      .where(eq(savedNote.userId, user.id))
      .orderBy(desc(savedNote.createdAt));
  }

  if (notes.length === 0) {
    recordUsage(env, ctx, request, user, `export_${format}`, {
      status: "error",
      errorCode: "no_notes",
    });
    return jsonResponse({ error: "No notes found to export" }, 404);
  }

  const markdown = buildExportMarkdown(notes, user.name);

  recordUsage(env, ctx, request, user, `export_${format}`, {
    responseChars: markdown.length,
    metadata: { noteCount: notes.length },
  });

  if (format === "markdown") {
    return new Response(markdown, {
      headers: {
        "Content-Type": "text/markdown; charset=utf-8",
        "Content-Disposition": `attachment; filename="interview-notes-${new Date().toISOString().split("T")[0]}.md"`,
      },
    });
  }

  // For PDF, return HTML that can be printed to PDF client-side
  const html = buildExportHTML(markdown, user.name);
  return new Response(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
    },
  });
}

// ─── Usage (user-facing) ─────────────────────────────────────────────────────

const USAGE_WINDOWS: Record<string, number> = {
  "24h": 86_400_000,
  "7d": 7 * 86_400_000,
  "30d": 30 * 86_400_000,
  "90d": 90 * 86_400_000,
};

async function handleUsageMe(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  url: URL,
): Promise<Response> {
  const authResult = await getAuthenticatedUser(request, env, ctx);
  if (!isAuthed(authResult)) return authErrorResponse(authResult.error);

  const windowKey = (url.searchParams.get("window") ?? "30d").trim();
  const windowMs = USAGE_WINDOWS[windowKey];
  if (!windowMs) {
    return jsonResponse({ error: "window must be one of 24h, 7d, 30d, 90d" }, 400);
  }

  const since = new Date(Date.now() - windowMs);
  const db = getDb(env);

  const summary = await getUserUsageSummary(db, authResult.id, since);

  // Choose a sensible bucket width so the chart has ~30 points regardless
  // of window size.
  const bucketSeconds = Math.max(60, Math.floor(windowMs / 1000 / 30));
  const series = await getUsageTimeseries(env.DB, since, bucketSeconds, authResult.id);

  return jsonResponse({
    window: windowKey,
    since: since.toISOString(),
    bucketSeconds,
    totals: summary.totals,
    perAction: summary.perAction,
    timeseries: series,
  });
}

function buildExportMarkdown(
  notes: Array<{
    id: string;
    content: string;
    tag: string;
    createdAt: Date;
  }>,
  userName: string,
): string {
  const lines: string[] = [
    `# Interview Notes — ${userName}`,
    `_Exported on ${new Date().toLocaleDateString("en-US", { dateStyle: "long" })}_`,
    "",
    "---",
    "",
  ];

  for (const note of notes) {
    const date = new Date(note.createdAt).toLocaleString("en-US", {
      dateStyle: "medium",
      timeStyle: "short",
    });
    lines.push(`## ${note.tag} · ${note.id.slice(0, 8)}`);
    lines.push(`**${note.tag}** · ${date}`);
    lines.push("");
    lines.push(note.content);
    lines.push("");
    lines.push("---");
    lines.push("");
  }

  return lines.join("\n");
}

function buildExportHTML(markdown: string, userName: string): string {
  // Escape every dynamic value: both the body content and the user-supplied
  // display name (previously interpolated raw into <title>, allowing a
  // crafted name to close the tag and inject script in the downloaded HTML).
  const escapedContent = escapeHtml(markdown);
  const escapedName = escapeHtml(userName ?? "");

  // Tight CSP so the generated file cannot load remote resources. We allow
  // `'unsafe-inline'` on script-src only for the one print() invocation, but
  // connect/img/etc stay `'none'` so no data can be exfiltrated if any
  // injection slipped through.
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src 'none'; connect-src 'none'; font-src 'none';">
  <title>Interview Notes — ${escapedName}</title>
  <style>
    body { font-family: 'Inter', -apple-system, sans-serif; max-width: 800px; margin: 2rem auto; padding: 0 1rem; color: #1a1a1a; line-height: 1.7; }
    h1 { font-size: 1.8rem; border-bottom: 2px solid #e5e7eb; padding-bottom: 0.5rem; }
    h2 { font-size: 1.3rem; margin-top: 2rem; color: #374151; }
    hr { border: none; border-top: 1px solid #e5e7eb; margin: 1.5rem 0; }
    pre { white-space: pre-wrap; font-family: inherit; }
    @media print { body { margin: 0; } }
  </style>
</head>
<body>
  <pre>${escapedContent}</pre>
  <script>window.onload = function() { window.print(); }</script>
</body>
</html>`;
}
