/** Better Auth session listing + revocation. */

import { and, count, desc, eq, like, or } from "drizzle-orm";
import { APIError, createAuthEndpoint, sessionMiddleware } from "better-auth/api";
import { session, user } from "../../../db/schema";
import { parseLimit, parseOffset, sanitizeSearch } from "../helpers";
import {
  revokeAllSessionsSchema,
  revokeSessionSchema,
} from "../schemas";
import type { AdminDeps } from "../types";

export function sessionEndpoints(deps: AdminDeps) {
  const { isAdmin, opts, recordAudit } = deps;
  return {
    adminListSessions: createAuthEndpoint(
      "/self-hosted-admin/list-sessions",
      { method: "GET", use: [sessionMiddleware] },
      async (ctx) => {
        if (!(await isAdmin(ctx.context.session.user.email)))
          throw new APIError("FORBIDDEN");
        const db = opts.getDb();
        const url = new URL(ctx.request?.url ?? "http://localhost");
        const limit = parseLimit(url.searchParams.get("limit"));
        const offset = parseOffset(url.searchParams.get("offset"));
        const q = sanitizeSearch(url.searchParams.get("q"));

        const baseSelect = {
          id: session.id,
          userId: session.userId,
          expiresAt: session.expiresAt,
          createdAt: session.createdAt,
          ipAddress: session.ipAddress,
          userAgent: session.userAgent,
          userEmail: user.email,
          userName: user.name,
        };

        const conditions: ReturnType<typeof eq>[] = [];
        if (q) {
          const safeQ = q.replace(/%/g, "\\%").replace(/_/g, "\\_");
          conditions.push(or(like(user.email, `%${safeQ}%`), like(user.name, `%${safeQ}%`))!);
        }
        const where = conditions.length > 0 ? and(...conditions) : undefined;

        const baseQuery = db.select(baseSelect).from(session).innerJoin(user, eq(session.userId, user.id));
        const countQuery = db.select({ total: count() }).from(session).innerJoin(user, eq(session.userId, user.id));

        const [rows, [{ total }]] = await Promise.all([
          where
            ? baseQuery.where(where).orderBy(desc(session.updatedAt)).limit(limit).offset(offset)
            : baseQuery.orderBy(desc(session.updatedAt)).limit(limit).offset(offset),
          where ? countQuery.where(where) : countQuery,
        ]);
        return ctx.json({ sessions: rows, total });
      },
    ),

    adminRevokeSession: createAuthEndpoint(
      "/self-hosted-admin/revoke-session",
      { method: "POST", use: [sessionMiddleware], body: revokeSessionSchema },
      async (ctx) => {
        const adminEmail = ctx.context.session.user.email;
        if (!(await isAdmin(adminEmail))) throw new APIError("FORBIDDEN");
        const db = opts.getDb();
        const { sessionId } = ctx.body;
        await recordAudit({
          eventType: "session_revoked",
          metadata: { sessionId, adminEmail },
        });
        await db.delete(session).where(eq(session.id, sessionId));
        return ctx.json({ ok: true });
      },
    ),

    adminRevokeAllSessions: createAuthEndpoint(
      "/self-hosted-admin/revoke-all-sessions",
      { method: "POST", use: [sessionMiddleware], body: revokeAllSessionsSchema },
      async (ctx) => {
        const adminEmail = ctx.context.session.user.email;
        if (!(await isAdmin(adminEmail))) throw new APIError("FORBIDDEN");
        const db = opts.getDb();
        const { userId } = ctx.body;
        await recordAudit({
          eventType: "sessions_revoked_all",
          userId,
          metadata: { adminEmail },
        });
        await db.delete(session).where(eq(session.userId, userId));
        return ctx.json({ ok: true });
      },
    ),
  };
}
