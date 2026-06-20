/** Live session listing, detail, and termination. */

import {
  and,
  count,
  desc,
  eq,
  gte,
  isNotNull,
  isNull,
  like,
  lt,
  or,
} from "drizzle-orm";
import { APIError, createAuthEndpoint, sessionMiddleware } from "better-auth/api";
import { liveSession, session, usageEvent, user } from "../../../db/schema";
import { ADMIN_FETCH_TIMEOUT_MS, SAFE_ID_RE } from "../constants";
import { parseLimit, parseOffset, sanitizeSearch } from "../helpers";
import { liveSessionTerminateSchema } from "../schemas";
import type { AdminDeps } from "../types";

export function liveSessionEndpoints(deps: AdminDeps) {
  const { isAdmin, opts, recordAudit, resolveActiveAiConfig } = deps;
  return {
    adminListLiveSessions: createAuthEndpoint(
      "/self-hosted-admin/live-sessions",
      { method: "GET", use: [sessionMiddleware] },
      async (ctx) => {
        if (!(await isAdmin(ctx.context.session.user.email)))
          throw new APIError("FORBIDDEN");
        const db = opts.getDb();
        const url = new URL(ctx.request?.url ?? "http://localhost");
        const limit = parseLimit(url.searchParams.get("limit"));
        const offset = parseOffset(url.searchParams.get("offset"));
        const status = url.searchParams.get("status");
        const userId = url.searchParams.get("userId");
        const q = sanitizeSearch(url.searchParams.get("q"));

        // Sessions are "stale" if there's been no recorder activity
        // (Deepgram key mint, tracked event, etc.) in 5 minutes —
        // likely a browser tab crash.
        const STALE_AFTER_MS = 5 * 60_000;
        const staleCutoff = new Date(Date.now() - STALE_AFTER_MS);

        const conditions: ReturnType<typeof eq>[] = [];
        if (userId && SAFE_ID_RE.test(userId)) conditions.push(eq(liveSession.userId, userId));
        if (status === "active") {
          conditions.push(isNull(liveSession.endedAt));
          conditions.push(gte(liveSession.lastSeenAt, staleCutoff));
        } else if (status === "stale") {
          conditions.push(isNull(liveSession.endedAt));
          conditions.push(lt(liveSession.lastSeenAt, staleCutoff));
        } else if (status === "ended") {
          conditions.push(isNotNull(liveSession.endedAt));
        }
        if (q) {
          const safeQ = q.replace(/%/g, "\\%").replace(/_/g, "\\_");
          conditions.push(
            or(
              like(liveSession.userEmail, `%${safeQ}%`),
              like(liveSession.ipAddress, `%${safeQ}%`),
            )!,
          );
        }
        const where = conditions.length > 0 ? and(...conditions) : undefined;

        const baseSelect = {
          id: liveSession.id,
          userId: liveSession.userId,
          userEmail: liveSession.userEmail,
          surface: liveSession.surface,
          ipAddress: liveSession.ipAddress,
          startedAt: liveSession.startedAt,
          lastSeenAt: liveSession.lastSeenAt,
          endedAt: liveSession.endedAt,
          endedBy: liveSession.endedBy,
          endReason: liveSession.endReason,
          deepgramKeyId: liveSession.deepgramKeyId,
          eventCount: liveSession.eventCount,
          userName: user.name,
        };

        const [rows, totalRows] = await Promise.all([
          where
            ? db
                .select(baseSelect)
                .from(liveSession)
                .leftJoin(user, eq(liveSession.userId, user.id))
                .where(where)
                .orderBy(desc(liveSession.startedAt))
                .limit(limit)
                .offset(offset)
            : db
                .select(baseSelect)
                .from(liveSession)
                .leftJoin(user, eq(liveSession.userId, user.id))
                .orderBy(desc(liveSession.startedAt))
                .limit(limit)
                .offset(offset),
          where
            ? db.select({ total: count() }).from(liveSession).where(where)
            : db.select({ total: count() }).from(liveSession),
        ]);

        const now = Date.now();
        const sessions = rows.map((r) => ({
          ...r,
          status: r.endedAt
            ? "ended"
            : r.lastSeenAt && now - r.lastSeenAt.getTime() > STALE_AFTER_MS
              ? "stale"
              : "active",
          durationMs:
            (r.endedAt ?? r.lastSeenAt ?? new Date()).getTime() - r.startedAt.getTime(),
        }));

        return ctx.json({
          sessions,
          total: totalRows[0]?.total ?? 0,
          staleAfterMs: STALE_AFTER_MS,
        });
      },
    ),

    adminGetLiveSession: createAuthEndpoint(
      "/self-hosted-admin/live-session",
      { method: "GET", use: [sessionMiddleware] },
      async (ctx) => {
        if (!(await isAdmin(ctx.context.session.user.email)))
          throw new APIError("FORBIDDEN");
        const db = opts.getDb();
        const url = new URL(ctx.request?.url ?? "http://localhost");
        const id = url.searchParams.get("id") ?? "";
        if (!SAFE_ID_RE.test(id))
          throw new APIError("BAD_REQUEST", { message: "Invalid id" });

        const [row] = await db.select().from(liveSession).where(eq(liveSession.id, id));
        if (!row) throw new APIError("NOT_FOUND", { message: "Session not found" });

        // We can't filter by JSON column directly, so we LIKE over
        // metadata. The leading `"sessionId":"` is enough to disambiguate.
        const sessionMetaPattern = `%"sessionId":"${id}"%`;
        const events = await db
          .select({
            id: usageEvent.id,
            action: usageEvent.action,
            status: usageEvent.status,
            errorCode: usageEvent.errorCode,
            promptChars: usageEvent.promptChars,
            responseChars: usageEvent.responseChars,
            durationMs: usageEvent.durationMs,
            metadata: usageEvent.metadata,
            createdAt: usageEvent.createdAt,
          })
          .from(usageEvent)
          .where(
            and(
              eq(usageEvent.userId, row.userId),
              like(usageEvent.metadata, sessionMetaPattern),
            ),
          )
          .orderBy(desc(usageEvent.createdAt))
          .limit(200);

        return ctx.json({
          session: row,
          events,
          staleAfterMs: 5 * 60_000,
        });
      },
    ),

    adminTerminateLiveSession: createAuthEndpoint(
      "/self-hosted-admin/live-session-terminate",
      { method: "POST", use: [sessionMiddleware], body: liveSessionTerminateSchema },
      async (ctx) => {
        const adminEmail = ctx.context.session.user.email;
        if (!(await isAdmin(adminEmail))) throw new APIError("FORBIDDEN");
        const db = opts.getDb();
        const { sessionId, reason, revokeAuthSessions } = ctx.body;

        const [row] = await db
          .select({
            id: liveSession.id,
            userId: liveSession.userId,
            userEmail: liveSession.userEmail,
            endedAt: liveSession.endedAt,
            deepgramKeyId: liveSession.deepgramKeyId,
            deepgramProjectId: liveSession.deepgramProjectId,
          })
          .from(liveSession)
          .where(eq(liveSession.id, sessionId));
        if (!row) throw new APIError("NOT_FOUND", { message: "Session not found" });
        if (row.endedAt) throw new APIError("BAD_REQUEST", { message: "Session already ended" });

        const now = new Date();

        // Step 1 — revoke the upstream Deepgram key so the recorder's
        // WebSocket dies on the next audio chunk. This is the actual
        // kill switch; all the local DB updates below are bookkeeping.
        let deepgramRevoked = false;
        let deepgramError: string | null = null;
        if (row.deepgramKeyId && row.deepgramProjectId) {
          try {
            const cfg = await resolveActiveAiConfig();
            if (!cfg.deepgramKey) {
              deepgramError = "deepgram_master_key_missing";
            } else {
              const resp = await fetch(
                `https://api.deepgram.com/v1/projects/${encodeURIComponent(row.deepgramProjectId)}/keys/${encodeURIComponent(row.deepgramKeyId)}`,
                {
                  method: "DELETE",
                  headers: {
                    Authorization: `Token ${cfg.deepgramKey}`,
                    accept: "application/json",
                  },
                  signal: AbortSignal.timeout(ADMIN_FETCH_TIMEOUT_MS),
                },
              );
              // 200/204 = revoked, 404 = already gone (TTL elapsed)
              deepgramRevoked = resp.ok || resp.status === 404;
              if (!deepgramRevoked) {
                deepgramError = `HTTP ${resp.status}`;
              }
            }
          } catch (e) {
            deepgramError = e instanceof Error ? e.message : String(e);
            console.warn("[SelfHostedAdmin] deepgram revoke failed:", deepgramError);
          }
        }

        // Step 2 — mark the session ended in our DB so the dashboard
        // updates and the candidate can't reuse the same sessionId to
        // mint a fresh key.
        await db
          .update(liveSession)
          .set({
            endedAt: now,
            lastSeenAt: now,
            endedBy: `admin:${adminEmail}`,
            endReason: reason || "terminated_by_admin",
          })
          .where(eq(liveSession.id, sessionId));

        // Step 3 — optionally revoke the user's auth sessions so a
        // suspect candidate can't simply press Start again. Default true
        // because that's the intent 99% of the time.
        const shouldRevoke = revokeAuthSessions !== false;
        if (shouldRevoke) {
          try {
            await db.delete(session).where(eq(session.userId, row.userId));
          } catch (e) {
            console.warn(
              "[SelfHostedAdmin] terminate: revoke auth sessions failed:",
              e,
            );
          }
        }

        await recordAudit({
          eventType: "admin_action",
          userId: row.userId,
          userEmail: row.userEmail,
          metadata: {
            action: "live_session_terminate",
            sessionId,
            reason: reason ?? null,
            deepgramKeyId: row.deepgramKeyId,
            deepgramRevoked,
            deepgramError,
            authSessionsRevoked: shouldRevoke,
            adminEmail,
          },
        });

        return ctx.json({
          ok: true,
          sessionId,
          endedAt: now.toISOString(),
          deepgramRevoked,
          deepgramError,
          authSessionsRevoked: shouldRevoke,
        });
      },
    ),
  };
}
