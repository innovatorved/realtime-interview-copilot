/** Shared DB maintenance invoked by admin POST and Cron Trigger. */

import { and, isNull, lt } from "drizzle-orm";
import { getDb } from "../db";
import { liveSession, rateLimitEntry, session } from "../db/schema";
import type { Env } from "../env";

const STALE_LIVE_SESSION_MS = 5 * 60_000;

export async function runScheduledMaintenance(env: Env) {
  const db = getDb(env);
  const now = new Date();
  const staleCutoff = new Date(now.getTime() - STALE_LIVE_SESSION_MS);

  await db.delete(rateLimitEntry).where(lt(rateLimitEntry.expiresAt, now));
  await db.delete(session).where(lt(session.expiresAt, now));

  await db
    .update(liveSession)
    .set({
      endedAt: now,
      lastSeenAt: now,
      endedBy: "system",
      endReason: "stale_timeout",
    })
    .where(
      and(isNull(liveSession.endedAt), lt(liveSession.lastSeenAt, staleCutoff)),
    );

  return { cleanedAt: now.toISOString() };
}
