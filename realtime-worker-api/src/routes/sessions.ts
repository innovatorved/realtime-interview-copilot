/** /api/sessions/{start,end} — live session lifecycle for admin visibility.
 *
 *  The recorder pings these endpoints so admins can see who is mid-interview
 *  in real time and intervene (pause / terminate / push a message). We
 *  intentionally keep the surface small and never accept arbitrary control
 *  signals from the client — only the admin plugin writes `controlSignal`. */

import { and, asc, eq, inArray, lt, sql } from "drizzle-orm";
import { getDb } from "../db";
import { liveSession } from "../db/schema";
import {
  authErrorResponse,
  getAuthenticatedUser,
  isAuthed,
} from "../middleware/auth";
import { getClientIp } from "../lib/ip";
import { jsonResponse } from "../lib/http";
import { SAFE_SESSION_ID_RE } from "../lib/ids";
import { recordUsage } from "../usage";
import type { Env } from "../env";

const MAX_CONCURRENT_LIVE_SESSIONS_PER_USER = 2;
const STALE_LIVE_SESSION_MS = 4 * 60 * 60 * 1000;

interface SessionStartBody {
  surface?: unknown;
  metadata?: unknown;
}

interface SessionMutationBody {
  sessionId?: unknown;
  reason?: unknown;
}

export async function handleSessionStart(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  const authResult = await getAuthenticatedUser(request, env, ctx);
  if (!isAuthed(authResult)) return authErrorResponse(authResult.error);

  // Cheap per-user rate limit so a runaway client cannot spam start.
  if (env.COMPLETION_LIMITER) {
    try {
      const { success } = await env.COMPLETION_LIMITER.limit({
        key: `session_start:${authResult.id}`,
      });
      if (!success)
        return jsonResponse({ error: "Too many sessions, slow down." }, 429);
    } catch (err) {
      console.warn(
        "[Worker] session_start limiter threw, failing closed:",
        err,
      );
      return jsonResponse({ error: "Rate limiter unavailable" }, 503);
    }
  }

  let body: SessionStartBody = {};
  try {
    body = (await request.json()) as SessionStartBody;
  } catch {
    body = {};
  }
  if (body === null || typeof body !== "object") body = {};

  const surface =
    typeof body.surface === "string" && body.surface.length <= 50
      ? body.surface
      : "web";
  const metaObj =
    body.metadata &&
    typeof body.metadata === "object" &&
    !Array.isArray(body.metadata)
      ? (body.metadata as Record<string, unknown>)
      : null;

  const db = getDb(env);

  const now = new Date();
  const staleCutoff = new Date(now.getTime() - STALE_LIVE_SESSION_MS);
  try {
    await db
      .update(liveSession)
      .set({
        endedAt: now,
        lastSeenAt: now,
        endedBy: "system",
        endReason: "stale_timeout",
      })
      .where(
        and(
          eq(liveSession.userId, authResult.id),
          sql`${liveSession.endedAt} IS NULL`,
          lt(liveSession.lastSeenAt, staleCutoff),
        ),
      );
  } catch (e) {
    console.warn("[Worker] opportunistic stale session cleanup failed:", e);
  }

  // Cap concurrent active sessions per user so a misbehaving client can't
  // fill the live-sessions list for admins. The cap is a FIFO ring, not a
  // hard error: a real human can be over the cap because a prior Electron
  // process was force-killed before `/api/sessions/end` ever fired (the
  // "keepalive: true" unload hook is best-effort), and surfacing a 409
  // there means the user is locked out for the row's lifetime. Instead,
  // when the user is at the cap, auto-end the OLDEST active row so we
  // stay within the cap AND let the new session through. Eviction here is
  // tagged `endedBy: "system"` / `endReason: "evicted_for_new_session"`
  // so admins can still tell evictions apart from genuine user-stops in
  // the dashboard.
  const activeRows = await db
    .select({ id: liveSession.id, startedAt: liveSession.startedAt })
    .from(liveSession)
    .where(
      and(
        eq(liveSession.userId, authResult.id),
        sql`${liveSession.endedAt} IS NULL`,
      ),
    )
    .orderBy(asc(liveSession.startedAt));
  if (activeRows.length >= MAX_CONCURRENT_LIVE_SESSIONS_PER_USER) {
    // Evict any rows past the (cap - 1) head so this new insert fits.
    // Cap - 1 because we're about to add a fresh row immediately after.
    const overflow = activeRows.length - (MAX_CONCURRENT_LIVE_SESSIONS_PER_USER - 1);
    const evictIds = activeRows.slice(0, overflow).map((r) => r.id);
    try {
      await db
        .update(liveSession)
        .set({
          endedAt: now,
          lastSeenAt: now,
          endedBy: "system",
          endReason: "evicted_for_new_session",
        })
        .where(inArray(liveSession.id, evictIds));
      console.log(
        `[Worker] auto-evicted ${evictIds.length} active session(s) for user ${authResult.id} on new start`,
      );
    } catch (e) {
      console.warn(
        "[Worker] live_session eviction failed (continuing best-effort):",
        e,
      );
    }
  }

  const id = crypto.randomUUID();

  try {
    await db.insert(liveSession).values({
      id,
      userId: authResult.id,
      userEmail: authResult.email,
      surface,
      ipAddress: getClientIp(request),
      userAgent: request.headers.get("user-agent")?.slice(0, 500) ?? null,
      startedAt: now,
      lastSeenAt: now,
      metadata: metaObj ? JSON.stringify(metaObj).slice(0, 4000) : null,
    });
  } catch (e) {
    console.warn("[Worker] live_session insert failed:", e);
    return jsonResponse({ error: "Could not start session" }, 500);
  }

  recordUsage(env, ctx, request, authResult, "session_started", {
    metadata: { sessionId: id, surface },
  });

  return jsonResponse({ sessionId: id, startedAt: now.toISOString() }, 201);
}

export async function handleSessionEnd(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  const authResult = await getAuthenticatedUser(request, env, ctx);
  if (!isAuthed(authResult)) return authErrorResponse(authResult.error);

  let body: SessionMutationBody;
  try {
    body = (await request.json()) as SessionMutationBody;
  } catch {
    return jsonResponse({ error: "Invalid JSON" }, 400);
  }
  const sessionId = typeof body?.sessionId === "string" ? body.sessionId : "";
  if (!SAFE_SESSION_ID_RE.test(sessionId)) {
    return jsonResponse({ error: "Invalid sessionId" }, 400);
  }
  const reason =
    typeof body?.reason === "string"
      ? body.reason.slice(0, 100)
      : "user_stopped";

  const db = getDb(env);
  const [row] = await db
    .select({
      id: liveSession.id,
      userId: liveSession.userId,
      endedAt: liveSession.endedAt,
    })
    .from(liveSession)
    .where(eq(liveSession.id, sessionId))
    .limit(1);
  if (!row) return jsonResponse({ error: "Session not found" }, 404);
  if (row.userId !== authResult.id)
    return jsonResponse({ error: "Forbidden" }, 403);
  if (row.endedAt) return jsonResponse({ ok: true, alreadyEnded: true });

  const now = new Date();
  await db
    .update(liveSession)
    .set({ endedAt: now, lastSeenAt: now, endedBy: "user", endReason: reason })
    .where(eq(liveSession.id, sessionId));

  recordUsage(env, ctx, request, authResult, "session_ended", {
    metadata: { sessionId, reason, endedBy: "user" },
  });

  return jsonResponse({ ok: true, endedAt: now.toISOString() });
}

/**
 * End every active live_session row owned by the caller. Used by the
 * client to recover from "you already have N active sessions" when an
 * earlier process was force-killed before its end ping fired (Electron
 * SIGKILL, crashed renderer, lost network on unload, etc.).
 *
 * Always idempotent — returns the count we ended so the client can show
 * a "Cleared N stale sessions" status, or zero when there was nothing to
 * clean.
 */
export async function handleSessionEndAll(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  const authResult = await getAuthenticatedUser(request, env, ctx);
  if (!isAuthed(authResult)) return authErrorResponse(authResult.error);

  let body: SessionMutationBody = {};
  try {
    body = (await request.json()) as SessionMutationBody;
  } catch {
    body = {};
  }
  const reason =
    typeof body?.reason === "string"
      ? body.reason.slice(0, 100)
      : "user_cleanup";

  const db = getDb(env);
  const activeRows = await db
    .select({ id: liveSession.id })
    .from(liveSession)
    .where(
      and(
        eq(liveSession.userId, authResult.id),
        sql`${liveSession.endedAt} IS NULL`,
      ),
    );
  if (activeRows.length === 0) {
    return jsonResponse({ ok: true, endedCount: 0 });
  }

  const now = new Date();
  const ids = activeRows.map((r) => r.id);
  try {
    await db
      .update(liveSession)
      .set({ endedAt: now, lastSeenAt: now, endedBy: "user", endReason: reason })
      .where(inArray(liveSession.id, ids));
  } catch (e) {
    console.warn("[Worker] live_session end-all failed:", e);
    return jsonResponse({ error: "Could not end sessions" }, 500);
  }

  recordUsage(env, ctx, request, authResult, "session_ended", {
    metadata: { endedCount: ids.length, reason, endedBy: "user", bulk: true },
  });

  return jsonResponse({ ok: true, endedCount: ids.length });
}
