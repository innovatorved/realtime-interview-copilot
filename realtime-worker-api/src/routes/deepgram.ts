/** Deepgram key minting routes.
 *
 *  Shares core minting logic between `handleDeepgram` (system audio /
 *  transcript flow, can bind to a live_session) and `handleDeepgramAsk`
 *  (Ask AI mic, no live_session), while preserving their distinct rate-limit
 *  buckets, analytics metadata, and session binding behavior. */

import { eq } from "drizzle-orm";
import { getCachedConfig } from "../config-cache";
import { getDb } from "../db";
import { liveSession } from "../db/schema";
import {
  authErrorResponse,
  getAuthenticatedUser,
  isAuthed,
  type AuthedUser,
} from "../middleware/auth";
import { jsonHeaders, jsonResponse } from "../lib/http";
import { getClientIp } from "../lib/ip";
import { limitByIp } from "../lib/ip-rate-limit";
import { SAFE_SESSION_ID_RE } from "../lib/ids";
import { recordUsage, startUsage } from "../usage";
import { checkQuota, consumeQuota } from "../services/quota.service";
import type { Env } from "../env";

const DEEPGRAM_TIMEOUT_MS = 10_000;
const PROJECT_ID_TTL_MS = 10 * 60_000;

type DeepgramProjectsResponse = {
  projects: Array<{ project_id: string }>;
};

type DeepgramKeyResponse = Record<string, unknown> & {
  error?: unknown;
  /** The new key id Deepgram returns; we persist it on live_session so admins can revoke. */
  api_key_id?: string;
};

const projectIdCache = new Map<
  string,
  { projectId: string; expiresAt: number }
>();

interface MintDeepgramKeyOptions {
  authResult: AuthedUser;
  sessionId: string | null;
  usageMetadata?: Record<string, unknown>;
  keyComment: string;
  keyTags: string[];
  logPrefix: string;
}

async function resolveDeepgramProjectId(
  apiKey: string,
  authHeaders: Record<string, string>,
): Promise<
  | { ok: true; projectId: string }
  | { ok: false; status: number; errorCode: string; response: Response }
> {
  const cached = projectIdCache.get(apiKey);
  if (cached && cached.expiresAt > Date.now()) {
    return { ok: true, projectId: cached.projectId };
  }

  const projectsResponse = await fetch(
    "https://api.deepgram.com/v1/projects",
    {
      method: "GET",
      headers: authHeaders,
      signal: AbortSignal.timeout(DEEPGRAM_TIMEOUT_MS),
    },
  );

  const projectsBody =
    (await projectsResponse.json()) as DeepgramProjectsResponse;

  if (!projectsResponse.ok) {
    return {
      ok: false,
      status: projectsResponse.status,
      errorCode: String(projectsResponse.status),
      response: new Response(JSON.stringify(projectsBody), {
        status: projectsResponse.status,
        headers: jsonHeaders,
      }),
    };
  }

  const project = projectsBody.projects?.[0];
  if (!project) {
    return {
      ok: false,
      status: 404,
      errorCode: "no_project",
      response: jsonResponse(
        {
          error:
            "Cannot find a Deepgram project. Please create a project first.",
        },
        404,
      ),
    };
  }

  projectIdCache.set(apiKey, {
    projectId: project.project_id,
    expiresAt: Date.now() + PROJECT_ID_TTL_MS,
  });

  return { ok: true, projectId: project.project_id };
}

async function mintTemporaryDeepgramKey(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  opts: MintDeepgramKeyOptions,
): Promise<Response> {
  const {
    authResult,
    sessionId,
    usageMetadata,
    keyComment,
    keyTags,
    logPrefix,
  } = opts;

  const [quotaCheck, cfg] = await Promise.all([
    checkQuota(getDb(env), env, authResult.id, "deepgram_seconds"),
    getCachedConfig(env),
  ]);

  if (!quotaCheck.allowed) {
    recordUsage(env, ctx, request, authResult, "deepgram_key", {
      status: "rate_limited",
      errorCode: "quota_exceeded",
      ...(usageMetadata ? { metadata: usageMetadata } : {}),
    });
    return jsonResponse(
      {
        error: "Monthly audio transcription quota exceeded.",
        resetAt: quotaCheck.resetAt.toISOString(),
      },
      429,
    );
  }

  const tracker = startUsage(
    env,
    ctx,
    request,
    authResult,
    "deepgram_key",
    usageMetadata ? { metadata: usageMetadata } : undefined,
  );

  const apiKey = cfg.deepgramKey;
  if (!apiKey) {
    tracker.finish({ status: "error", errorCode: "missing_key" });
    return jsonResponse(
      {
        error:
          "Missing Deepgram API key — set via Admin Dashboard or DEEPGRAM_API_KEY env var",
      },
      500,
    );
  }

  const authHeaders = {
    Authorization: `Token ${apiKey}`,
    accept: "application/json",
  };

  try {
    const projectResolution = await resolveDeepgramProjectId(
      apiKey,
      authHeaders,
    );
    if (!projectResolution.ok) {
      tracker.finish({
        status: "error",
        errorCode: projectResolution.errorCode,
      });
      return projectResolution.response;
    }

    const projectId = projectResolution.projectId;
    const createResponse = await fetch(
      `https://api.deepgram.com/v1/projects/${projectId}/keys`,
      {
        method: "POST",
        headers: {
          ...authHeaders,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          comment: keyComment,
          scopes: ["usage:write"],
          tags: keyTags,
          time_to_live_in_seconds: 60,
        }),
        signal: AbortSignal.timeout(DEEPGRAM_TIMEOUT_MS),
      },
    );

    const createBody = (await createResponse.json()) as DeepgramKeyResponse;

    if (!createResponse.ok && createResponse.status === 404) {
      projectIdCache.delete(apiKey);
    }

    tracker.finish({
      status: createResponse.ok ? "ok" : "error",
      errorCode: createResponse.ok ? null : String(createResponse.status),
    });

    if (createResponse.ok) {
      ctx.waitUntil(
        consumeQuota(getDb(env), env, authResult.id, "deepgram_seconds", {
          seconds: 60,
        }),
      );
    }

    if (
      createResponse.ok &&
      sessionId &&
      typeof createBody.api_key_id === "string"
    ) {
      // Bind the new key to the live_session so admins can revoke it.
      // Best-effort: a write failure must not break the recorder flow.
      ctx.waitUntil(
        getDb(env)
          .update(liveSession)
          .set({
            deepgramKeyId: createBody.api_key_id,
            deepgramProjectId: projectId,
            lastSeenAt: new Date(),
          })
          .where(eq(liveSession.id, sessionId))
          .execute()
          .catch((e) =>
            console.warn("[Worker] live_session deepgram bind failed:", e),
          ),
      );
    }

    return new Response(JSON.stringify(createBody), {
      status: createResponse.ok ? 200 : createResponse.status,
      headers: jsonHeaders,
    });
  } catch (err) {
    console.warn(`[Worker] ${logPrefix} upstream failed:`, err);
    tracker.finish({ status: "error", errorCode: "upstream_timeout" });
    return jsonResponse(
      { error: "Upstream timeout or error talking to Deepgram" },
      504,
    );
  }
}

export async function handleDeepgram(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  // Require authentication so the project's paid Deepgram key is never minted
  // for anonymous callers.
  const authResult = await getAuthenticatedUser(request, env, ctx);
  if (!isAuthed(authResult)) return authErrorResponse(authResult.error);

  // Optional `?sessionId=` ties the minted key to a live_session row so an
  // admin can `terminate` that session and we can DELETE the upstream key,
  // dropping the candidate's WebSocket on the next audio chunk. The
  // recorder still works without it (older clients), but admin termination
  // only works when the binding is present.
  const reqUrl = new URL(request.url);
  const sessionIdRaw = reqUrl.searchParams.get("sessionId");
  const sessionId =
    sessionIdRaw && SAFE_SESSION_ID_RE.test(sessionIdRaw) ? sessionIdRaw : null;
  if (sessionId) {
    const [row] = await getDb(env)
      .select({ userId: liveSession.userId, endedAt: liveSession.endedAt })
      .from(liveSession)
      .where(eq(liveSession.id, sessionId))
      .limit(1);
    if (!row) return jsonResponse({ error: "Session not found" }, 404);
    if (row.userId !== authResult.id)
      return jsonResponse({ error: "Forbidden" }, 403);
    if (row.endedAt)
      return jsonResponse({ error: "Session has already ended" }, 410);
  }

  // Per-user rate limit. Use COMPLETION_LIMITER binding when available; fail
  // closed when the binding throws (except when the binding itself is absent
  // in local dev — there we intentionally fall open so the loopback works).
  if (env.COMPLETION_LIMITER) {
    const ip = getClientIp(request);
    const ipLimit = await limitByIp(env, "deepgram", ip);
    if (!ipLimit.ok) {
      recordUsage(env, ctx, request, authResult, "deepgram_key", {
        status: "rate_limited",
        errorCode: String(ipLimit.status),
      });
      return jsonResponse(
        { error: "Rate limit exceeded. Try again in a minute." },
        ipLimit.status,
      );
    }
    const key = `deepgram:${authResult.id}`;
    try {
      const { success } = await env.COMPLETION_LIMITER.limit({ key });
      if (!success) {
        recordUsage(env, ctx, request, authResult, "deepgram_key", {
          status: "rate_limited",
          errorCode: "429",
        });
        return jsonResponse(
          { error: "Rate limit exceeded. Try again in a minute." },
          429,
        );
      }
    } catch (err) {
      console.warn(
        "[Worker] deepgram rate limiter threw, failing closed:",
        err,
      );
      return jsonResponse({ error: "Rate limiter unavailable" }, 503);
    }
  }

  return mintTemporaryDeepgramKey(request, env, ctx, {
    authResult,
    sessionId,
    keyComment: `Temporary API key (user ${authResult.id})`,
    keyTags: ["cloudflare-worker", `user:${authResult.id}`],
    logPrefix: "deepgram",
  });
}

/**
 * Mint a short-lived Deepgram key for the Ask AI mic feature. Mirrors
 * `handleDeepgram` (auth, rate-limit, project lookup, key creation) but:
 *   - does not require / bind a live_session row
 *   - uses a dedicated rate-limit bucket and usage tracking type so we can
 *     distinguish Ask-AI-mic from copilot transcription in analytics
 *   - same 60 s TTL + `usage:write`-only scope, so a leaked key is bounded
 */
export async function handleDeepgramAsk(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  const authResult = await getAuthenticatedUser(request, env, ctx);
  if (!isAuthed(authResult)) return authErrorResponse(authResult.error);

  if (env.COMPLETION_LIMITER) {
    const key = `deepgram-ask:${authResult.id}`;
    try {
      const { success } = await env.COMPLETION_LIMITER.limit({ key });
      if (!success) {
        recordUsage(env, ctx, request, authResult, "deepgram_key", {
          status: "rate_limited",
          errorCode: "429",
          metadata: { source: "ask_mic" },
        });
        return jsonResponse(
          { error: "Rate limit exceeded. Try again in a minute." },
          429,
        );
      }
    } catch (err) {
      console.warn(
        "[Worker] deepgram-ask rate limiter threw, failing closed:",
        err,
      );
      return jsonResponse({ error: "Rate limiter unavailable" }, 503);
    }
  }

  return mintTemporaryDeepgramKey(request, env, ctx, {
    authResult,
    sessionId: null,
    usageMetadata: { source: "ask_mic" },
    keyComment: `Ask AI mic temporary key (user ${authResult.id})`,
    keyTags: ["cloudflare-worker", "ask-mic", `user:${authResult.id}`],
    logPrefix: "deepgram-ask",
  });
}
