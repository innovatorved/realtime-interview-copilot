/** Live session repository — ownership-scoped queries. */

import { and, asc, eq, inArray, lt, sql } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import { liveSession } from "../db/schema";

type Db = DrizzleD1Database<Record<string, never>>;

export async function listActiveSessionsForUser(db: Db, userId: string) {
  return db
    .select({ id: liveSession.id, startedAt: liveSession.startedAt })
    .from(liveSession)
    .where(
      and(eq(liveSession.userId, userId), sql`${liveSession.endedAt} IS NULL`),
    )
    .orderBy(asc(liveSession.startedAt));
}

export async function endStaleSessionsForUser(
  db: Db,
  userId: string,
  staleBefore: Date,
  now: Date,
) {
  return db
    .update(liveSession)
    .set({
      endedAt: now,
      lastSeenAt: now,
      endedBy: "system",
      endReason: "stale_timeout",
    })
    .where(
      and(
        eq(liveSession.userId, userId),
        sql`${liveSession.endedAt} IS NULL`,
        lt(liveSession.lastSeenAt, staleBefore),
      ),
    );
}

export async function evictSessionsByIds(db: Db, ids: string[], now: Date) {
  if (ids.length === 0) return;
  return db
    .update(liveSession)
    .set({
      endedAt: now,
      lastSeenAt: now,
      endedBy: "system",
      endReason: "evicted_for_new_session",
    })
    .where(inArray(liveSession.id, ids));
}

export async function getSessionForUser(db: Db, sessionId: string, userId: string) {
  const [row] = await db
    .select({
      id: liveSession.id,
      userId: liveSession.userId,
      endedAt: liveSession.endedAt,
    })
    .from(liveSession)
    .where(eq(liveSession.id, sessionId))
    .limit(1);
  if (!row || row.userId !== userId) return null;
  return row;
}
