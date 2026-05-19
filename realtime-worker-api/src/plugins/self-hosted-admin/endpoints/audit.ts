/** Audit and security event listings + activity feed. */

import { and, count, desc, eq, like, or } from "drizzle-orm";
import { APIError, createAuthEndpoint, sessionMiddleware } from "better-auth/api";
import { auditEvent, securityEvent } from "../../../db/schema";
import { SAFE_ID_RE } from "../constants";
import { parseLimit, parseOffset, sanitizeSearch } from "../helpers";
import type { AdminDeps } from "../types";

export function auditEndpoints(deps: AdminDeps) {
  const { isAdmin, opts } = deps;
  return {
    adminAuditLogs: createAuthEndpoint(
      "/self-hosted-admin/audit-logs",
      { method: "GET", use: [sessionMiddleware] },
      async (ctx) => {
        if (!(await isAdmin(ctx.context.session.user.email)))
          throw new APIError("FORBIDDEN");
        const db = opts.getDb();
        const url = new URL(ctx.request?.url ?? "http://localhost");
        const limit = parseLimit(url.searchParams.get("limit"));
        const offset = parseOffset(url.searchParams.get("offset"));
        const eventType = url.searchParams.get("eventType");
        const userId = url.searchParams.get("userId");
        const q = sanitizeSearch(url.searchParams.get("q"));
        const conditions: ReturnType<typeof eq>[] = [];
        if (eventType) conditions.push(eq(auditEvent.eventType, eventType));
        if (userId && SAFE_ID_RE.test(userId)) conditions.push(eq(auditEvent.userId, userId));
        if (q) {
          const safeQ = q.replace(/%/g, "\\%").replace(/_/g, "\\_");
          conditions.push(or(like(auditEvent.userEmail, `%${safeQ}%`), like(auditEvent.ipAddress, `%${safeQ}%`))!);
        }
        const where = conditions.length > 0 ? and(...conditions) : undefined;
        const [rows, [{ total }]] = await Promise.all([
          where
            ? db.select().from(auditEvent).where(where).orderBy(desc(auditEvent.createdAt)).limit(limit).offset(offset)
            : db.select().from(auditEvent).orderBy(desc(auditEvent.createdAt)).limit(limit).offset(offset),
          where
            ? db.select({ total: count() }).from(auditEvent).where(where)
            : db.select({ total: count() }).from(auditEvent),
        ]);
        return ctx.json({ events: rows, total });
      },
    ),

    adminSecurityEvents: createAuthEndpoint(
      "/self-hosted-admin/security-events",
      { method: "GET", use: [sessionMiddleware] },
      async (ctx) => {
        if (!(await isAdmin(ctx.context.session.user.email)))
          throw new APIError("FORBIDDEN");
        const db = opts.getDb();
        const url = new URL(ctx.request?.url ?? "http://localhost");
        const limit = parseLimit(url.searchParams.get("limit"));
        const offset = parseOffset(url.searchParams.get("offset"));
        const eventType = url.searchParams.get("eventType");
        const q = sanitizeSearch(url.searchParams.get("q"));
        const conditions: ReturnType<typeof eq>[] = [];
        if (eventType) conditions.push(eq(securityEvent.eventType, eventType));
        if (q) {
          const safeQ = q.replace(/%/g, "\\%").replace(/_/g, "\\_");
          conditions.push(or(like(securityEvent.userEmail, `%${safeQ}%`), like(securityEvent.ipAddress, `%${safeQ}%`))!);
        }
        const where = conditions.length > 0 ? and(...conditions) : undefined;
        const [rows, [{ total }]] = await Promise.all([
          where
            ? db.select().from(securityEvent).where(where).orderBy(desc(securityEvent.createdAt)).limit(limit).offset(offset)
            : db.select().from(securityEvent).orderBy(desc(securityEvent.createdAt)).limit(limit).offset(offset),
          where
            ? db.select({ total: count() }).from(securityEvent).where(where)
            : db.select({ total: count() }).from(securityEvent),
        ]);
        return ctx.json({ events: rows, total });
      },
    ),

    adminActivity: createAuthEndpoint(
      "/self-hosted-admin/activity",
      { method: "GET", use: [sessionMiddleware] },
      async (ctx) => {
        if (!(await isAdmin(ctx.context.session.user.email)))
          throw new APIError("FORBIDDEN");
        const db = opts.getDb();
        const url = new URL(ctx.request?.url ?? "http://localhost");
        const limit = parseLimit(url.searchParams.get("limit"));
        const rows = await db.select().from(auditEvent).orderBy(desc(auditEvent.createdAt)).limit(limit);
        return ctx.json({ events: rows });
      },
    ),
  };
}
