/** Fail-closed atomic rate limit.
 *
 *  The row id is a deterministic hash of the rate-limit key (`rl:<key>`),
 *  which makes the primary-key INSERT-or-UPDATE single-statement and
 *  eliminates the select→update race the previous implementation had.
 *  ON CONFLICT(id) uses the existing PRIMARY KEY (no migration required)
 *  and we read the post-write count back via RETURNING so concurrent
 *  attempts on the same key serialise cleanly. */

import { lt } from "drizzle-orm";
import { rateLimitEntry } from "../../../db/schema";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import type * as schemaTypes from "../../../db/schema";
import { RATE_LIMIT_WINDOW_MS } from "../constants";

type DbHandle = DrizzleD1Database<typeof schemaTypes>;

export function createCheckRateLimit(getDb: () => DbHandle, d1: D1Database) {
  return async function checkRateLimit(key: string, maxAttempts: number) {
    try {
      const now = new Date();
      const nowSec = Math.floor(now.getTime() / 1000);
      const expiresSec = nowSec + Math.floor(RATE_LIMIT_WINDOW_MS / 1000);
      const cutoffSec = nowSec - Math.floor(RATE_LIMIT_WINDOW_MS / 1000);

      // Periodic cleanup of expired rows. Best-effort; failures must not
      // change the decision below.
      try {
        const db = getDb();
        await db.delete(rateLimitEntry).where(lt(rateLimitEntry.expiresAt, now));
      } catch {
        /* best-effort */
      }

      // Deterministic id so repeated calls with the same `key` target the
      // same row and ON CONFLICT(id) can upsert atomically.
      const idBytes = new TextEncoder().encode(`rl:${key}`);
      const digest = await crypto.subtle.digest("SHA-256", idBytes);
      const id = Array.from(new Uint8Array(digest))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("")
        .slice(0, 64);

      const result = await d1
        .prepare(
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
      return { allowed: newCount <= maxAttempts, count: newCount };
    } catch (err) {
      console.error(
        "[SelfHostedAdmin] rate limit check failed, failing closed:",
        err,
      );
      return { allowed: false, count: maxAttempts + 1 };
    }
  };
}
