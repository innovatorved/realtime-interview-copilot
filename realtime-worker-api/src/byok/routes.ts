/**
 * User-facing BYOK ("bring your own key") routes.
 *
 * Every route is gated by `requireFlag(env, userId, "byok")` — disabled
 * users get 403 with `feature_flag_disabled` so the renderer can render a
 * "contact admin" message without leaking that the flag exists for some
 * other user.
 *
 * Routes:
 *   GET    /api/byok/status                 → masked status (no plaintext)
 *   POST   /api/byok/credential             → upsert (encrypted)
 *   DELETE /api/byok/credential/:provider   → wipe a row
 *   POST   /api/byok/credential/:provider/toggle → user-side active flag
 *   GET    /api/byok/runtime-config         → DECRYPTED token+url+model
 *
 * The runtime-config route is the only path that returns plaintext;
 * it is owner-only, no-store, and rate-limited via the existing
 * rate_limit table pattern (see selfHostedAdmin.checkRateLimit). The
 * Electron renderer fetches it once per session into in-memory state.
 */

import { and, eq } from "drizzle-orm";
import { getDb } from "../db";
import { byokCredential } from "../db/schema";
import { decryptToken, encryptToken } from "./crypto";
import { validateProviderUrl, type Provider } from "./url";
import { requireFlag } from "../feature-flags/middleware";
import { recordUsage } from "../usage";

interface MinimalEnv {
  DB: D1Database;
  BYOK_ENC_KEY?: string;
}

interface AuthedUser {
  id: string;
  email: string;
}

const MAX_TOKEN_LEN = 512;
const MAX_MODEL_LEN = 200;

// Per-user windowed rate limits to keep BYOK endpoints from being abused.
// Implemented inline against the existing rate_limit table so we don't
// need to reach into the admin plugin's private helper. Fail-closed if
// the check itself errors — these are non-essential UX paths.
const RUNTIME_CONFIG_RATE_LIMIT = 60; // per minute per user
const CREDENTIAL_WRITE_RATE_LIMIT = 20; // per minute per user
const RATE_LIMIT_WINDOW_MS = 60_000;

async function checkByokRateLimit(
  env: MinimalEnv,
  userId: string,
  bucket: string,
  maxAttempts: number,
): Promise<{ allowed: boolean }> {
  try {
    const now = Date.now();
    const nowSec = Math.floor(now / 1000);
    const expiresSec = nowSec + Math.floor(RATE_LIMIT_WINDOW_MS / 1000);
    const cutoffSec = nowSec - Math.floor(RATE_LIMIT_WINDOW_MS / 1000);
    const key = `byok:${bucket}:${userId}`;
    const idBytes = new TextEncoder().encode(`rl:${key}`);
    const digest = await crypto.subtle.digest("SHA-256", idBytes);
    const id = Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("")
      .slice(0, 64);
    const result = await env.DB.prepare(
      `INSERT INTO rate_limit (id, key, count, windowStart, expiresAt)
       VALUES (?1, ?2, 1, ?3, ?4)
       ON CONFLICT(id) DO UPDATE SET
         count = CASE WHEN rate_limit.windowStart < ?5 THEN 1 ELSE rate_limit.count + 1 END,
         windowStart = CASE WHEN rate_limit.windowStart < ?5 THEN ?3 ELSE rate_limit.windowStart END,
         expiresAt = CASE WHEN rate_limit.windowStart < ?5 THEN ?4 ELSE rate_limit.expiresAt END
       RETURNING count`,
    )
      .bind(id, key, nowSec, expiresSec, cutoffSec)
      .first<{ count: number }>();
    const newCount = result?.count ?? 1;
    return { allowed: newCount <= maxAttempts };
  } catch (err) {
    console.warn("[byok] rate limit check failed, failing closed:", err);
    return { allowed: false };
  }
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "Cache-Control": "no-store" },
  });
}

function isProvider(s: unknown): s is Provider {
  return s === "deepgram" || s === "openai";
}

function maskedStatus(row: typeof byokCredential.$inferSelect | undefined) {
  if (!row) return null;
  return {
    configured: true,
    provider: row.provider,
    baseUrl: row.baseUrl,
    tokenLast4: row.tokenLast4,
    modelName: row.modelName,
    active: row.active === true,
    disabledByAdmin: row.disabledByAdmin === true,
    updatedAt: row.updatedAt,
  };
}

export async function handleByokStatus(
  _request: Request,
  env: MinimalEnv,
  user: AuthedUser,
): Promise<Response> {
  const gate = await requireFlag(env, user.id, "byok");
  if (!gate.ok) return jsonResponse(gate.body, gate.status);

  const db = getDb(env);
  const rows = await db
    .select()
    .from(byokCredential)
    .where(eq(byokCredential.userId, user.id));

  const deepgram = rows.find((r) => r.provider === "deepgram");
  const openai = rows.find((r) => r.provider === "openai");

  return jsonResponse({
    enabled: true,
    deepgram: maskedStatus(deepgram),
    openai: maskedStatus(openai),
  });
}

export async function handleByokUpsertCredential(
  request: Request,
  env: MinimalEnv,
  ctx: ExecutionContext,
  user: AuthedUser,
): Promise<Response> {
  const gate = await requireFlag(env, user.id, "byok");
  if (!gate.ok) return jsonResponse(gate.body, gate.status);

  const rl = await checkByokRateLimit(env, user.id, "write", CREDENTIAL_WRITE_RATE_LIMIT);
  if (!rl.allowed) return jsonResponse({ error: "rate_limited" }, 429);

  if (!env.BYOK_ENC_KEY) {
    return jsonResponse(
      { error: "BYOK is not fully configured (missing encryption key)" },
      503,
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON" }, 400);
  }
  if (!body || typeof body !== "object") {
    return jsonResponse({ error: "Invalid body" }, 400);
  }
  const b = body as Record<string, unknown>;

  if (!isProvider(b.provider)) {
    return jsonResponse({ error: "provider must be 'deepgram' or 'openai'" }, 400);
  }
  const provider = b.provider;

  if (typeof b.token !== "string" || b.token.length === 0 || b.token.length > MAX_TOKEN_LEN) {
    return jsonResponse({ error: "token is required and must be a short string" }, 400);
  }
  if (typeof b.baseUrl !== "string") {
    return jsonResponse({ error: "baseUrl is required" }, 400);
  }
  const urlCheck = validateProviderUrl(b.baseUrl, provider);
  if (!urlCheck.ok) {
    return jsonResponse({ error: `Invalid baseUrl: ${urlCheck.reason}` }, 400);
  }

  let modelName: string | null = null;
  if (provider === "openai") {
    if (b.modelName !== undefined) {
      if (typeof b.modelName !== "string" || b.modelName.length === 0 || b.modelName.length > MAX_MODEL_LEN) {
        return jsonResponse({ error: "modelName must be a short non-empty string" }, 400);
      }
      modelName = b.modelName;
    } else {
      return jsonResponse({ error: "modelName is required for openai" }, 400);
    }
  }

  let encrypted;
  try {
    encrypted = await encryptToken(b.token, env.BYOK_ENC_KEY);
  } catch (e) {
    console.warn("[byok] encrypt failed:", e instanceof Error ? e.message : "unknown");
    return jsonResponse({ error: "Failed to encrypt token" }, 500);
  }

  const db = getDb(env);
  const now = new Date();
  const [existing] = await db
    .select({ id: byokCredential.id })
    .from(byokCredential)
    .where(
      and(
        eq(byokCredential.userId, user.id),
        eq(byokCredential.provider, provider),
      ),
    );

  if (existing) {
    await db
      .update(byokCredential)
      .set({
        baseUrl: urlCheck.data.url,
        tokenCiphertext: encrypted.tokenCiphertext,
        tokenIv: encrypted.tokenIv,
        tokenLast4: encrypted.tokenLast4,
        modelName,
        updatedAt: now,
      })
      .where(eq(byokCredential.id, existing.id));
  } else {
    await db.insert(byokCredential).values({
      id: crypto.randomUUID(),
      userId: user.id,
      provider,
      baseUrl: urlCheck.data.url,
      tokenCiphertext: encrypted.tokenCiphertext,
      tokenIv: encrypted.tokenIv,
      tokenLast4: encrypted.tokenLast4,
      modelName,
      active: true,
      disabledByAdmin: false,
      createdAt: now,
      updatedAt: now,
    });
  }

  recordUsage(env, ctx, request, user, "byok_credential_upserted", {
    metadata: { provider, host: urlCheck.data.host, last4: encrypted.tokenLast4 },
  });

  return jsonResponse({
    ok: true,
    provider,
    baseUrl: urlCheck.data.url,
    host: urlCheck.data.host,
    tokenLast4: encrypted.tokenLast4,
  });
}

export async function handleByokDeleteCredential(
  request: Request,
  env: MinimalEnv,
  ctx: ExecutionContext,
  user: AuthedUser,
  provider: string,
): Promise<Response> {
  const gate = await requireFlag(env, user.id, "byok");
  if (!gate.ok) return jsonResponse(gate.body, gate.status);
  if (!isProvider(provider)) {
    return jsonResponse({ error: "Unknown provider" }, 400);
  }
  const db = getDb(env);
  await db
    .delete(byokCredential)
    .where(
      and(
        eq(byokCredential.userId, user.id),
        eq(byokCredential.provider, provider),
      ),
    );
  recordUsage(env, ctx, request, user, "byok_credential_deleted", {
    metadata: { provider },
  });
  return jsonResponse({ ok: true });
}

export async function handleByokToggleCredential(
  request: Request,
  env: MinimalEnv,
  ctx: ExecutionContext,
  user: AuthedUser,
  provider: string,
): Promise<Response> {
  const gate = await requireFlag(env, user.id, "byok");
  if (!gate.ok) return jsonResponse(gate.body, gate.status);
  if (!isProvider(provider)) {
    return jsonResponse({ error: "Unknown provider" }, 400);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON" }, 400);
  }
  if (!body || typeof body !== "object" || typeof (body as { active?: unknown }).active !== "boolean") {
    return jsonResponse({ error: "active boolean is required" }, 400);
  }
  const active = (body as { active: boolean }).active;

  const db = getDb(env);
  const result = await db
    .update(byokCredential)
    .set({ active, updatedAt: new Date() })
    .where(
      and(
        eq(byokCredential.userId, user.id),
        eq(byokCredential.provider, provider),
      ),
    )
    .returning({ id: byokCredential.id });

  if (result.length === 0) {
    return jsonResponse({ error: "Credential not found" }, 404);
  }
  recordUsage(env, ctx, request, user, "byok_credential_toggled", {
    metadata: { provider, active },
  });
  return jsonResponse({ ok: true, active });
}

/**
 * Owner-only decrypted runtime config consumed by the renderer.
 * Returns ONLY rows that are user-active AND not admin-disabled, so the
 * worker is the single source of truth for "is this credential live".
 */
export async function handleByokRuntimeConfig(
  request: Request,
  env: MinimalEnv,
  ctx: ExecutionContext,
  user: AuthedUser,
): Promise<Response> {
  const gate = await requireFlag(env, user.id, "byok");
  if (!gate.ok) return jsonResponse(gate.body, gate.status);

  const rl = await checkByokRateLimit(env, user.id, "runtime", RUNTIME_CONFIG_RATE_LIMIT);
  if (!rl.allowed) return jsonResponse({ error: "rate_limited" }, 429);

  if (!env.BYOK_ENC_KEY) {
    return jsonResponse(
      { error: "BYOK is not fully configured (missing encryption key)" },
      503,
    );
  }

  const db = getDb(env);
  const rows = await db
    .select()
    .from(byokCredential)
    .where(eq(byokCredential.userId, user.id));

  const out: {
    deepgram: { baseUrl: string; host: string; token: string } | null;
    openai: { baseUrl: string; host: string; token: string; modelName: string | null } | null;
  } = { deepgram: null, openai: null };

  for (const row of rows) {
    if (row.active !== true || row.disabledByAdmin === true) continue;
    let token: string;
    try {
      token = await decryptToken(row, env.BYOK_ENC_KEY);
    } catch (e) {
      console.warn("[byok] decrypt failed for", row.provider, ":", e instanceof Error ? e.message : "unknown");
      continue;
    }
    let host = "";
    try {
      host = new URL(row.baseUrl).hostname.toLowerCase();
    } catch {
      continue;
    }
    if (row.provider === "deepgram") {
      out.deepgram = { baseUrl: row.baseUrl, host, token };
    } else if (row.provider === "openai") {
      out.openai = {
        baseUrl: row.baseUrl,
        host,
        token,
        modelName: row.modelName,
      };
    }
  }

  recordUsage(env, ctx, request, user, "byok_runtime_config_read", {
    metadata: {
      hasDeepgram: out.deepgram !== null,
      hasOpenai: out.openai !== null,
    },
  });

  return jsonResponse(out);
}
