import { auth } from "./auth";
import { trackLLMGeneration, type PostHogEnv } from "./posthog";
import { getDb } from "./db";
import { savedNote, interviewPreset, user as userTable, adminConfig } from "./db/schema";
import { eq, desc, like, or, and, sql, count } from "drizzle-orm";

enum FLAGS {
  COPILOT = "copilot",
  SUMMARIZER = "summarizer",
}

interface ResolvedConfig {
  geminiModel: string;
  geminiKey: string;
  deepgramKey: string;
  customModelName: string;
  customBaseUrl: string;
  customApiKey: string;
  useCustom: boolean;
}

async function resolveConfig(env: Env): Promise<ResolvedConfig> {
  try {
    const db = getDb(env);
    const rows = await db.select().from(adminConfig);
    const map = new Map(rows.map((r) => [r.key, r.value]));

    const customModelName = map.get("custom_model_name") || "";
    const customBaseUrl = map.get("custom_base_url") || "";
    const customApiKey = map.get("custom_api_key") || "";
    const useCustom = Boolean(customModelName && customBaseUrl && customApiKey);

    return {
      geminiModel: map.get("gemini_model") || env.GEMINI_MODEL || "gemini-2.5-flash-lite",
      geminiKey: map.get("gemini_key") || env.GOOGLE_GENERATIVE_AI_API_KEY || "",
      deepgramKey: map.get("deepgram_key") || env.DEEPGRAM_API_KEY || "",
      customModelName,
      customBaseUrl,
      customApiKey,
      useCustom,
    };
  } catch (err) {
    console.error("Failed to load admin config from D1, using env defaults:", err);
    return {
      geminiModel: env.GEMINI_MODEL || "gemini-2.5-flash-lite",
      geminiKey: env.GOOGLE_GENERATIVE_AI_API_KEY || "",
      deepgramKey: env.DEEPGRAM_API_KEY || "",
      customModelName: "",
      customBaseUrl: "",
      customApiKey: "",
      useCustom: false,
    };
  }
}

interface Env extends PostHogEnv {
  DEEPGRAM_API_KEY: string;
  GOOGLE_GENERATIVE_AI_API_KEY: string;
  GEMINI_MODEL?: string;
  BETTER_AUTH_SECRET: string;
  BETTER_AUTH_URL: string;
  /** Comma-separated emails allowed to use /api/admin/* (self-hosted dashboard). */
  ADMIN_EMAILS?: string;
  DB: D1Database;
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
  // Expected format: data:<mime>;base64,<data>
  const match = /^data:([^;]+);base64,(.+)$/.exec(input.trim());
  if (!match) return null;
  const mime = match[1];
  const data = match[2];
  // Only accept common web image types and cap size to prevent abuse.
  // Validation protects against unexpected mime types being forwarded.
  if (!/^image\/(png|jpeg|jpg|webp|gif)$/i.test(mime)) return null;
  // Rough base64 size check: limit to ~8MB decoded. base64 is ~4/3 of bytes.
  if (data.length > (8 * 1024 * 1024 * 4) / 3) return null;
  return { mimeType: mime, base64: data };
}

interface WorkerExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException?(): void;
}

const jsonHeaders = {
  "content-type": "application/json",
};

const encoder = new TextEncoder();

const ALLOWED_METHODS = "GET,POST,PUT,DELETE,OPTIONS";
const ALLOWED_HEADERS = "Content-Type,Authorization";
const CORS_MAX_AGE = "86400";

const TRUSTED_ORIGINS = new Set([
  "http://localhost:3000",
  "http://localhost:3001",
  "https://copilot.vedgupta.in",
  "https://interview-copilot-admin.vedgupta.in",
  "https://realtime-worker-api-prod.vedgupta.in",
]);

function buildCorsHeaders(request: Request) {
  const origin = request.headers.get("Origin");
  const allowOrigin = origin && TRUSTED_ORIGINS.has(origin) ? origin : TRUSTED_ORIGINS.values().next().value!;

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

const ACTIVITY_UPDATE_INTERVAL_MS = 5 * 60 * 1000;
const lastActivityUpdates = new Map<string, number>();

async function getAuthenticatedUser(
  request: Request,
  env: Env,
): Promise<{ id: string; email: string; name: string } | null> {
  try {
    const session = await auth(env).api.getSession({
      headers: request.headers,
    });
    if (!session?.user) return null;

    const userId = session.user.id;
    const now = Date.now();
    const lastUpdate = lastActivityUpdates.get(userId) ?? 0;
    if (now - lastUpdate > ACTIVITY_UPDATE_INTERVAL_MS) {
      lastActivityUpdates.set(userId, now);
      getDb(env).update(userTable).set({ lastActiveAt: new Date() }).where(eq(userTable.id, userId)).execute().catch(() => {});
    }

    return {
      id: userId,
      email: session.user.email,
      name: session.user.name,
    };
  } catch {
    return null;
  }
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

export default {
  async fetch(
    request: Request,
    env: Env,
    ctx: WorkerExecutionContext,
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
      const response = await handleDeepgram(env);
      return withCors(response, request);
    }

    if (
      request.method === "POST" &&
      (path === "/api/completion" || path === "/completion")
    ) {
      const response = await handleCompletion(request, env, ctx);
      return withCors(response, request);
    }

    // --- Notes CRUD ---
    if (path === "/api/notes" && request.method === "GET") {
      const response = await handleGetNotes(request, env, url);
      return withCors(response, request);
    }
    if (path === "/api/notes" && request.method === "POST") {
      const response = await handleCreateNote(request, env);
      return withCors(response, request);
    }
    if (path.match(/^\/api\/notes\/[^/]+$/) && request.method === "DELETE") {
      const noteId = path.split("/").pop()!;
      const response = await handleDeleteNote(request, env, noteId);
      return withCors(response, request);
    }

    // --- Presets ---
    if (path === "/api/presets" && request.method === "GET") {
      const response = await handleGetPresets(request, env);
      return withCors(response, request);
    }

    // --- Export ---
    if (path === "/api/export" && request.method === "POST") {
      const response = await handleExport(request, env);
      return withCors(response, request);
    }

    if (path.startsWith("/api/auth")) {
      try {
        const response = await auth(env).handler(request);
        return withCors(response, request);
      } catch (e) {
        console.error("[Worker] Auth error:", e);
        return withCors(
          jsonResponse({ error: "Authentication error" }, 500),
          request,
        );
      }
    }

    return withCors(jsonResponse({ error: "Not found" }, 404), request);
  },
};

async function handleDeepgram(env: Env): Promise<Response> {
  const cfg = await resolveConfig(env);
  const apiKey = cfg.deepgramKey;

  if (!apiKey) {
    return new Response(
      JSON.stringify({ error: "Missing Deepgram API key — set via Admin Dashboard or DEEPGRAM_API_KEY env var" }),
      {
        status: 500,
        headers: jsonHeaders,
      },
    );
  }

  const authHeaders = {
    Authorization: `Token ${apiKey}`,
    accept: "application/json",
  };

  const projectsResponse = await fetch("https://api.deepgram.com/v1/projects", {
    method: "GET",
    headers: authHeaders,
  });

  const projectsBody =
    (await projectsResponse.json()) as DeepgramProjectsResponse;

  if (!projectsResponse.ok) {
    return new Response(JSON.stringify(projectsBody), {
      status: projectsResponse.status,
      headers: jsonHeaders,
    });
  }

  const project = projectsBody.projects?.[0];

  if (!project) {
    return new Response(
      JSON.stringify({
        error: "Cannot find a Deepgram project. Please create a project first.",
      }),
      {
        status: 404,
        headers: jsonHeaders,
      },
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
        comment: "Temporary API key",
        scopes: ["usage:write"],
        tags: ["cloudflare-worker"],
        time_to_live_in_seconds: 60,
      }),
    },
  );

  const createBody = (await createResponse.json()) as DeepgramKeyResponse;

  return new Response(JSON.stringify(createBody), {
    status: createResponse.ok ? 200 : createResponse.status,
    headers: jsonHeaders,
  });
}

async function handleCompletion(
  request: Request,
  env: Env,
  ctx: WorkerExecutionContext,
): Promise<Response> {
  let payload: CompletionRequestBody;
  try {
    payload = (await request.json()) as CompletionRequestBody;
  } catch (error) {
    return new Response(JSON.stringify({ error: "Invalid JSON payload" }), {
      status: 400,
      headers: jsonHeaders,
    });
  }

  const basePrompt = (payload?.prompt ?? "").trim();

  if (!basePrompt) {
    return new Response(JSON.stringify({ error: "prompt is required" }), {
      status: 400,
      headers: jsonHeaders,
    });
  }

  let finalPrompt = basePrompt;
  if (payload.flag === FLAGS.COPILOT) {
    finalPrompt = buildPrompt(payload.bg, basePrompt);
  } else if (payload.flag === FLAGS.SUMMARIZER) {
    finalPrompt = buildSummarizerPrompt(basePrompt);
  }

  const image = parseImageDataUrl(payload.image);

  const cfg = await resolveConfig(env);

  const activeModel = cfg.useCustom ? cfg.customModelName : cfg.geminiModel;
  const analytics = trackLLMGeneration({
    env,
    model: activeModel,
    prompt: finalPrompt,
    getUser: async () => {
      const session = await auth(env).api.getSession({ headers: request.headers });
      return session?.user ? { id: session.user.id, email: session.user.email, name: session.user.name } : null;
    },
  });

  const stream = new TransformStream();
  const writer = stream.writable.getWriter();

  const completionFn = cfg.useCustom
    ? streamOpenAICompatibleCompletion(finalPrompt, cfg.customModelName, cfg.customApiKey, cfg.customBaseUrl, writer, analytics.onText, image)
    : streamGeminiCompletion(finalPrompt, cfg.geminiModel, cfg.geminiKey, writer, analytics.onText, image);

  const pump = completionFn
    .catch(async (error: unknown) => {
      analytics.onError(error instanceof Error ? error : String(error));
      const message = error instanceof Error
        ? { error: error.message }
        : { error: String(error) };
      await writer.write(encoder.encode(`data: ${JSON.stringify(message)}\n\n`));
    })
    .finally(async () => {
      await writer.close();
      ctx.waitUntil(analytics.finalize());
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
  writer: WritableStreamDefaultWriter<Uint8Array>,
  onText?: (text: string) => void,
  image?: InlineImage | null,
) {
  if (!apiKey) {
    throw new Error("Missing Gemini API key — set via Admin Dashboard or GOOGLE_GENERATIVE_AI_API_KEY env var");
  }

  const url = `https://gateway.ai.cloudflare.com/v1/b4ca0337fb21e846c53e1f2611ba436c/gateway04/google-ai-studio/v1beta/models/${modelName}:streamGenerateContent?alt=sse&key=${apiKey}`;

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
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: requestBody,
    });

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
              onText?.(text);
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
    console.error("Error streaming from Gemini API:", error);
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
  onText?: (text: string) => void,
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
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: requestBody,
    });

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
            onText?.(delta);
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
  url: URL,
): Promise<Response> {
  const user = await getAuthenticatedUser(request, env);
  if (!user) return jsonResponse({ error: "Unauthorized" }, 401);

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
): Promise<Response> {
  const user = await getAuthenticatedUser(request, env);
  if (!user) return jsonResponse({ error: "Unauthorized" }, 401);

  let body: { content?: string; tag?: string; title?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return jsonResponse({ error: "Invalid JSON" }, 400);
  }

  const content = (body.content ?? "").trim();
  if (!content) return jsonResponse({ error: "content is required" }, 400);

  const db = getDb(env);
  const id = crypto.randomUUID();
  const now = new Date();

  const note = {
    id,
    userId: user.id,
    content,
    tag: body.tag ?? "Copilot",
    createdAt: now,
  };

  await db.insert(savedNote).values(note);

  return jsonResponse({ note }, 201);
}

async function handleDeleteNote(
  request: Request,
  env: Env,
  noteId: string,
): Promise<Response> {
  const user = await getAuthenticatedUser(request, env);
  if (!user) return jsonResponse({ error: "Unauthorized" }, 401);

  const db = getDb(env);
  await db
    .delete(savedNote)
    .where(and(eq(savedNote.id, noteId), eq(savedNote.userId, user.id)));

  return jsonResponse({ success: true });
}

// ─── Presets ─────────────────────────────────────────────────────────────────

async function handleGetPresets(
  request: Request,
  env: Env,
): Promise<Response> {
  const user = await getAuthenticatedUser(request, env);
  if (!user) return jsonResponse({ error: "Unauthorized" }, 401);

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

  return jsonResponse({ presets });
}

// ─── Export ──────────────────────────────────────────────────────────────────

interface ExportRequestBody {
  format: "markdown" | "pdf";
  noteIds?: string[];
  all?: boolean;
}

async function handleExport(
  request: Request,
  env: Env,
): Promise<Response> {
  const user = await getAuthenticatedUser(request, env);
  if (!user) return jsonResponse({ error: "Unauthorized" }, 401);

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
    return jsonResponse({ error: "No notes found to export" }, 404);
  }

  const markdown = buildExportMarkdown(notes, user.name);

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
  const escapedContent = markdown
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Interview Notes — ${userName}</title>
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
