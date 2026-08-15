/** Usage analytics endpoints (summary / by-user / detail / events / timeseries / CSV). */

import { and, count, desc, eq, gte } from "drizzle-orm";
import { APIError, createAuthEndpoint, sessionMiddleware } from "better-auth/api";
import { usageEvent, user } from "../../../db/schema";
import {
  getSystemUsageSummary,
  getTopUsersByUsage,
  getUsageTimeseries,
  getUserUsageSummary,
} from "../../../usage";
import { parseLimit, parseOffset, parseAdminQuery, resolveUsageWindow } from "../helpers";
import {
  usageByUserQuerySchema,
  usageEventsQuerySchema,
  usageSummaryQuerySchema,
  usageTimeseriesQuerySchema,
  usageUserDetailQuerySchema,
} from "../query-schemas";
import type { AdminDeps } from "../types";

export function usageEndpoints(deps: AdminDeps) {
  const { isAdmin, opts } = deps;
  return {
    adminUsageSummary: createAuthEndpoint(
      "/self-hosted-admin/usage/summary",
      { method: "GET", use: [sessionMiddleware] },
      async (ctx) => {
        if (!(await isAdmin(ctx.context.session.user.email)))
          throw new APIError("FORBIDDEN");
        const db = opts.getDb();
        const url = new URL(ctx.request?.url ?? "http://localhost");
        const query = parseAdminQuery(url, usageSummaryQuerySchema, ["window"]);
        const { since, window: w } = resolveUsageWindow(query.window ?? null);

        const summary = await getSystemUsageSummary(db, since);
        return ctx.json({
          window: w,
          since: since.toISOString(),
          totals: summary.totals,
          perAction: summary.perAction,
        });
      },
    ),

    adminUsageByUser: createAuthEndpoint(
      "/self-hosted-admin/usage/by-user",
      { method: "GET", use: [sessionMiddleware] },
      async (ctx) => {
        if (!(await isAdmin(ctx.context.session.user.email)))
          throw new APIError("FORBIDDEN");
        const db = opts.getDb();
        const url = new URL(ctx.request?.url ?? "http://localhost");
        const query = parseAdminQuery(url, usageByUserQuerySchema, ["window", "limit", "offset"]);
        const { since, window: w } = resolveUsageWindow(query.window ?? null);
        const limit = query.limit ?? parseLimit(null);
        const offset = query.offset ?? parseOffset(null);

        const rows = await getTopUsersByUsage(db, since, limit, offset);
        return ctx.json({ window: w, since: since.toISOString(), users: rows });
      },
    ),

    adminUsageUserDetail: createAuthEndpoint(
      "/self-hosted-admin/usage/user",
      { method: "GET", use: [sessionMiddleware] },
      async (ctx) => {
        if (!(await isAdmin(ctx.context.session.user.email)))
          throw new APIError("FORBIDDEN");
        const db = opts.getDb();
        const url = new URL(ctx.request?.url ?? "http://localhost");
        const query = parseAdminQuery(url, usageUserDetailQuerySchema, ["userId", "window"]);
        const { userId } = query;
        const { since, window: w } = resolveUsageWindow(query.window ?? null);

        const [targetUser] = await db
          .select({
            id: user.id,
            email: user.email,
            name: user.name,
            createdAt: user.createdAt,
            lastActiveAt: user.lastActiveAt,
          })
          .from(user)
          .where(eq(user.id, userId));
        if (!targetUser) throw new APIError("NOT_FOUND", { message: "User not found" });

        const summary = await getUserUsageSummary(db, userId, since);

        const windowMs = since ? Date.now() - since.getTime() : 30 * 86_400_000;
        const bucketSeconds = Math.max(60, Math.floor(windowMs / 1000 / 30));
        const series = await getUsageTimeseries(opts.d1, since, bucketSeconds, userId);

        return ctx.json({
          window: w,
          since: since.toISOString(),
          bucketSeconds,
          user: targetUser,
          totals: summary.totals,
          perAction: summary.perAction,
          timeseries: series,
        });
      },
    ),

    adminUsageEvents: createAuthEndpoint(
      "/self-hosted-admin/usage/events",
      { method: "GET", use: [sessionMiddleware] },
      async (ctx) => {
        if (!(await isAdmin(ctx.context.session.user.email)))
          throw new APIError("FORBIDDEN");
        const db = opts.getDb();
        const url = new URL(ctx.request?.url ?? "http://localhost");
        const query = parseAdminQuery(url, usageEventsQuerySchema, [
          "limit",
          "offset",
          "userId",
          "action",
          "status",
        ]);
        const limit = query.limit ?? parseLimit(null);
        const offset = query.offset ?? parseOffset(null);
        const userId = query.userId;
        const action = query.action;
        const status = query.status;

        const conditions: ReturnType<typeof eq>[] = [];
        if (userId) conditions.push(eq(usageEvent.userId, userId));
        if (action) conditions.push(eq(usageEvent.action, action));
        if (status) conditions.push(eq(usageEvent.status, status));
        const where = conditions.length > 0 ? and(...conditions) : undefined;

        const baseSelect = {
          id: usageEvent.id,
          userId: usageEvent.userId,
          userEmail: usageEvent.userEmail,
          action: usageEvent.action,
          flag: usageEvent.flag,
          model: usageEvent.model,
          promptChars: usageEvent.promptChars,
          responseChars: usageEvent.responseChars,
          durationMs: usageEvent.durationMs,
          status: usageEvent.status,
          errorCode: usageEvent.errorCode,
          ipAddress: usageEvent.ipAddress,
          createdAt: usageEvent.createdAt,
        };

        const [rows, [{ total }]] = await Promise.all([
          where
            ? db.select(baseSelect).from(usageEvent).where(where).orderBy(desc(usageEvent.createdAt)).limit(limit).offset(offset)
            : db.select(baseSelect).from(usageEvent).orderBy(desc(usageEvent.createdAt)).limit(limit).offset(offset),
          where
            ? db.select({ total: count() }).from(usageEvent).where(where)
            : db.select({ total: count() }).from(usageEvent),
        ]);

        return ctx.json({ events: rows, total });
      },
    ),

    adminUsageTimeseries: createAuthEndpoint(
      "/self-hosted-admin/usage/timeseries",
      { method: "GET", use: [sessionMiddleware] },
      async (ctx) => {
        if (!(await isAdmin(ctx.context.session.user.email)))
          throw new APIError("FORBIDDEN");
        const url = new URL(ctx.request?.url ?? "http://localhost");
        const query = parseAdminQuery(url, usageTimeseriesQuerySchema, ["window", "userId"]);
        const { since, window: w } = resolveUsageWindow(query.window ?? null);
        const userId = query.userId ?? null;
        const windowMs = Date.now() - since.getTime();
        const bucketSeconds = Math.max(60, Math.floor(windowMs / 1000 / 30));
        const series = await getUsageTimeseries(opts.d1, since, bucketSeconds, userId);
        return ctx.json({
          window: w,
          since: since.toISOString(),
          bucketSeconds,
          userId: userId ?? null,
          timeseries: series,
        });
      },
    ),

    adminUsageExportCsv: createAuthEndpoint(
      "/self-hosted-admin/usage/export.csv",
      { method: "GET", use: [sessionMiddleware] },
      async (ctx) => {
        if (!(await isAdmin(ctx.context.session.user.email)))
          throw new APIError("FORBIDDEN");
        const db = opts.getDb();
        const url = new URL(ctx.request?.url ?? "http://localhost");
        const query = parseAdminQuery(url, usageSummaryQuerySchema, ["window"]);
        const { since } = resolveUsageWindow(query.window ?? null);

        const rows = await db
          .select({
            userId: usageEvent.userId,
            userEmail: usageEvent.userEmail,
            action: usageEvent.action,
            flag: usageEvent.flag,
            model: usageEvent.model,
            promptChars: usageEvent.promptChars,
            responseChars: usageEvent.responseChars,
            durationMs: usageEvent.durationMs,
            status: usageEvent.status,
            errorCode: usageEvent.errorCode,
            createdAt: usageEvent.createdAt,
          })
          .from(usageEvent)
          .where(gte(usageEvent.createdAt, since))
          .orderBy(desc(usageEvent.createdAt))
          .limit(10_000);

        const esc = (v: unknown) => {
          if (v === null || v === undefined) return "";
          const s = String(v).replace(/"/g, '""');
          return /[",\n]/.test(s) ? `"${s}"` : s;
        };
        const header =
          "userId,userEmail,action,flag,model,promptChars,responseChars,durationMs,status,errorCode,createdAt";
        const lines = rows.map((r) =>
          [
            esc(r.userId),
            esc(r.userEmail),
            esc(r.action),
            esc(r.flag),
            esc(r.model),
            r.promptChars ?? 0,
            r.responseChars ?? 0,
            r.durationMs ?? 0,
            esc(r.status),
            esc(r.errorCode),
            r.createdAt ? new Date(r.createdAt).toISOString() : "",
          ].join(","),
        );
        return ctx.json({ csv: [header, ...lines].join("\n"), total: rows.length });
      },
    ),
  };
}
