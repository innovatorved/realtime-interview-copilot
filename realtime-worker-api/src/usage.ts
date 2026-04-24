/**
 * Usage tracking helper.
 *
 * Records one row per tracked user action into `usage_event`. Designed to be
 * cheap to call from request handlers:
 *   - All writes go through ctx.waitUntil so they never block the response.
 *   - Failures are logged but swallowed (we must never break a request
 *     because an analytics insert failed).
 *   - No prompt bodies are persisted — only approximate char counts — so the
 *     table stays small and privacy-preserving.
 *
 * Usage example:
 *
 *   const tracker = startUsage(env, ctx, request, userCtx, "completion", {
 *     flag: "copilot", model: "gemini-2.5-flash",
 *     promptChars: prompt.length,
 *   });
 *   // ... later ...
 *   tracker.finish({ responseChars: outBytes, status: "ok" });
 */

import type { DrizzleD1Database } from "drizzle-orm/d1";
import { and, count, desc, eq, gte, sql } from "drizzle-orm";
import { getDb } from "./db";
import { usageEvent, user as userTable } from "./db/schema";
import type * as schemaTypes from "./db/schema";

export interface TrackedUser {
  id: string;
  email?: string | null;
}

export interface StartUsageInit {
  flag?: string | null;
  model?: string | null;
  promptChars?: number;
  metadata?: Record<string, unknown>;
}

export interface FinishUsageInit {
  status?: "ok" | "error" | "rate_limited";
  errorCode?: string | null;
  responseChars?: number;
  model?: string | null;
  metadataPatch?: Record<string, unknown>;
}

export interface UsageTracker {
  finish(init?: FinishUsageInit): void;
}

type MinimalEnv = { DB: D1Database };

function ipOf(request: Request): string | null {
  return (
    request.headers.get("cf-connecting-ip") ??
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    null
  );
}

function uaOf(request: Request): string | null {
  const ua = request.headers.get("user-agent");
  if (!ua) return null;
  return ua.slice(0, 500);
}

/**
 * Start a usage measurement. Returns an object with `.finish()` the caller
 * invokes once the response is ready. Safe to ignore the return value (drop
 * it on the floor) — the DB write still fires, but duration/status will be
 * "ok"/0 by default.
 */
export function startUsage(
  env: MinimalEnv,
  ctx: ExecutionContext,
  request: Request,
  user: TrackedUser | null,
  action: string,
  init: StartUsageInit = {},
): UsageTracker {
  const startedAt = Date.now();
  let finished = false;

  const baseMeta: Record<string, unknown> = { ...(init.metadata ?? {}) };

  const doWrite = async (final: FinishUsageInit) => {
    try {
      const now = new Date();
      const durationMs = Math.max(0, Date.now() - startedAt);
      const mergedMeta = { ...baseMeta, ...(final.metadataPatch ?? {}) };
      const hasMeta = Object.keys(mergedMeta).length > 0;

      await getDb(env as unknown as Parameters<typeof getDb>[0]).insert(usageEvent).values({
        id: crypto.randomUUID(),
        userId: user?.id ?? null,
        userEmail: user?.email ?? null,
        action,
        flag: init.flag ?? null,
        model: final.model ?? init.model ?? null,
        promptChars: clampInt(init.promptChars ?? 0),
        responseChars: clampInt(final.responseChars ?? 0),
        durationMs,
        status: final.status ?? "ok",
        errorCode: final.errorCode ?? null,
        ipAddress: ipOf(request),
        userAgent: uaOf(request),
        metadata: hasMeta ? JSON.stringify(mergedMeta) : null,
        createdAt: now,
      });
    } catch (e) {
      // Never let analytics failures affect the request. Log only.
      console.warn("[usage] insert failed:", e);
    }
  };

  return {
    finish(final: FinishUsageInit = {}) {
      if (finished) return;
      finished = true;
      ctx.waitUntil(doWrite(final));
    },
  };
}

/**
 * Convenience wrapper to record a single, already-completed event (no
 * duration tracking). Useful for fire-and-forget endpoints like note delete.
 */
export function recordUsage(
  env: MinimalEnv,
  ctx: ExecutionContext,
  request: Request,
  user: TrackedUser | null,
  action: string,
  extra: FinishUsageInit & StartUsageInit = {},
): void {
  const t = startUsage(env, ctx, request, user, action, {
    flag: extra.flag,
    model: extra.model,
    promptChars: extra.promptChars,
    metadata: extra.metadata,
  });
  t.finish({
    status: extra.status,
    errorCode: extra.errorCode,
    responseChars: extra.responseChars,
    model: extra.model,
    metadataPatch: extra.metadataPatch,
  });
}

function clampInt(n: number): number {
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(Math.floor(n), 2_000_000_000);
}

// ─── Query helpers (used by both user-facing and admin endpoints) ─────────

export interface UsageWindow {
  since: Date;
}

type Db = DrizzleD1Database<typeof schemaTypes>;

/**
 * Aggregate counts + totals for a single user over a window. Returns overall
 * totals plus a per-action breakdown.
 */
export async function getUserUsageSummary(db: Db, userId: string, since: Date) {
  const [totals] = await db
    .select({
      events: count(),
      promptChars: sql<number>`COALESCE(SUM(${usageEvent.promptChars}), 0)`,
      responseChars: sql<number>`COALESCE(SUM(${usageEvent.responseChars}), 0)`,
      durationMs: sql<number>`COALESCE(SUM(${usageEvent.durationMs}), 0)`,
      errors: sql<number>`COALESCE(SUM(CASE WHEN ${usageEvent.status} != 'ok' THEN 1 ELSE 0 END), 0)`,
    })
    .from(usageEvent)
    .where(and(eq(usageEvent.userId, userId), gte(usageEvent.createdAt, since)));

  const perAction = await db
    .select({
      action: usageEvent.action,
      events: count(),
      promptChars: sql<number>`COALESCE(SUM(${usageEvent.promptChars}), 0)`,
      responseChars: sql<number>`COALESCE(SUM(${usageEvent.responseChars}), 0)`,
      durationMs: sql<number>`COALESCE(SUM(${usageEvent.durationMs}), 0)`,
      errors: sql<number>`COALESCE(SUM(CASE WHEN ${usageEvent.status} != 'ok' THEN 1 ELSE 0 END), 0)`,
    })
    .from(usageEvent)
    .where(and(eq(usageEvent.userId, userId), gte(usageEvent.createdAt, since)))
    .groupBy(usageEvent.action);

  return {
    totals: totals ?? { events: 0, promptChars: 0, responseChars: 0, durationMs: 0, errors: 0 },
    perAction,
  };
}

/**
 * Per-user leaderboard for admin: top N users by event count in window.
 * Joins `user` for email/name display. `userId` is nullable on usage_event
 * (anonymous actions) — we exclude those here.
 */
export async function getTopUsersByUsage(db: Db, since: Date, limit: number, offset = 0) {
  return await db
    .select({
      userId: usageEvent.userId,
      userEmail: userTable.email,
      userName: userTable.name,
      events: count(),
      promptChars: sql<number>`COALESCE(SUM(${usageEvent.promptChars}), 0)`,
      responseChars: sql<number>`COALESCE(SUM(${usageEvent.responseChars}), 0)`,
      durationMs: sql<number>`COALESCE(SUM(${usageEvent.durationMs}), 0)`,
      errors: sql<number>`COALESCE(SUM(CASE WHEN ${usageEvent.status} != 'ok' THEN 1 ELSE 0 END), 0)`,
      lastSeen: sql<number>`MAX(${usageEvent.createdAt})`,
    })
    .from(usageEvent)
    .leftJoin(userTable, eq(userTable.id, usageEvent.userId))
    .where(and(gte(usageEvent.createdAt, since), sql`${usageEvent.userId} IS NOT NULL`))
    .groupBy(usageEvent.userId)
    .orderBy(desc(count()))
    .limit(limit)
    .offset(offset);
}

/** System-wide totals and per-action split across all users. */
export async function getSystemUsageSummary(db: Db, since: Date) {
  const [totals] = await db
    .select({
      events: count(),
      uniqueUsers: sql<number>`COUNT(DISTINCT ${usageEvent.userId})`,
      promptChars: sql<number>`COALESCE(SUM(${usageEvent.promptChars}), 0)`,
      responseChars: sql<number>`COALESCE(SUM(${usageEvent.responseChars}), 0)`,
      durationMs: sql<number>`COALESCE(SUM(${usageEvent.durationMs}), 0)`,
      errors: sql<number>`COALESCE(SUM(CASE WHEN ${usageEvent.status} != 'ok' THEN 1 ELSE 0 END), 0)`,
    })
    .from(usageEvent)
    .where(gte(usageEvent.createdAt, since));

  const perAction = await db
    .select({
      action: usageEvent.action,
      events: count(),
      promptChars: sql<number>`COALESCE(SUM(${usageEvent.promptChars}), 0)`,
      responseChars: sql<number>`COALESCE(SUM(${usageEvent.responseChars}), 0)`,
      durationMs: sql<number>`COALESCE(SUM(${usageEvent.durationMs}), 0)`,
      errors: sql<number>`COALESCE(SUM(CASE WHEN ${usageEvent.status} != 'ok' THEN 1 ELSE 0 END), 0)`,
    })
    .from(usageEvent)
    .where(gte(usageEvent.createdAt, since))
    .groupBy(usageEvent.action);

  return {
    totals: totals ?? {
      events: 0, uniqueUsers: 0, promptChars: 0, responseChars: 0, durationMs: 0, errors: 0,
    },
    perAction,
  };
}

/**
 * Bucketed timeseries of event counts for the given window.
 * `bucketSeconds` is the bucket width; returned rows are sparse (no
 * zero-filling — the caller densifies if needed).
 */
export async function getUsageTimeseries(
  d1: D1Database,
  since: Date,
  bucketSeconds: number,
  userId?: string | null,
) {
  const startEpoch = Math.floor(since.getTime() / 1000);
  const args: unknown[] = [startEpoch, bucketSeconds, startEpoch];
  let userClause = "";
  if (userId) {
    userClause = " AND userId = ?4";
    args.push(userId);
  }
  const stmt = d1.prepare(
    `SELECT ((createdAt - ?1) / ?2) AS bucket, COUNT(*) AS events,
            COALESCE(SUM(promptChars), 0) AS promptChars,
            COALESCE(SUM(responseChars), 0) AS responseChars,
            COALESCE(SUM(durationMs), 0) AS durationMs,
            COALESCE(SUM(CASE WHEN status != 'ok' THEN 1 ELSE 0 END), 0) AS errors
     FROM usage_event
     WHERE createdAt >= ?3${userClause}
     GROUP BY bucket
     ORDER BY bucket`,
  );
  const bound = stmt.bind(...args);
  const { results } = await bound.all<{
    bucket: number;
    events: number;
    promptChars: number;
    responseChars: number;
    durationMs: number;
    errors: number;
  }>();
  return results;
}
