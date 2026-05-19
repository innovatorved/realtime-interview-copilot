/** Filtered admin query over usage_event for the "important events" UI. */

import { and, asc, count, desc, eq, gte, inArray, like, lte, or, sql } from "drizzle-orm";
import { APIError, createAuthEndpoint, sessionMiddleware } from "better-auth/api";
import { usageEvent } from "../../../db/schema";
import { IMPORTANT_EVENT_ACTIONS, SAFE_ID_RE } from "../constants";
import { parseLimit, parseOffset, sanitizeSearch } from "../helpers";
import type { AdminDeps } from "../types";

export function importantEventsEndpoints(deps: AdminDeps) {
  const { isAdmin, opts } = deps;
  return {
    adminImportantEvents: createAuthEndpoint(
      "/self-hosted-admin/important-events",
      { method: "GET", use: [sessionMiddleware] },
      async (ctx) => {
        if (!(await isAdmin(ctx.context.session.user.email)))
          throw new APIError("FORBIDDEN");
        const db = opts.getDb();
        const url = new URL(ctx.request?.url ?? "http://localhost");
        const limit = parseLimit(url.searchParams.get("limit"));
        const offset = parseOffset(url.searchParams.get("offset"));

        const userId = url.searchParams.get("userId");
        const status = url.searchParams.get("status");
        const sessionId = url.searchParams.get("sessionId");
        const q = sanitizeSearch(url.searchParams.get("q"));
        const startRaw = url.searchParams.get("start");
        const endRaw = url.searchParams.get("end");
        const sort = url.searchParams.get("sort") === "asc" ? "asc" : "desc";

        const actionsRaw = (url.searchParams.get("actions") ?? "")
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
        const actions =
          actionsRaw.length > 0
            ? actionsRaw.filter((a) =>
                (IMPORTANT_EVENT_ACTIONS as readonly string[]).includes(a),
              )
            : (IMPORTANT_EVENT_ACTIONS as readonly string[]);

        if (actions.length === 0) {
          throw new APIError("BAD_REQUEST", { message: "No valid actions in filter" });
        }

        const conditions: ReturnType<typeof eq>[] = [];
        conditions.push(inArray(usageEvent.action, actions as string[]));
        if (userId && SAFE_ID_RE.test(userId)) conditions.push(eq(usageEvent.userId, userId));
        if (status && /^[a-z_]{1,20}$/.test(status))
          conditions.push(eq(usageEvent.status, status));
        if (sessionId && SAFE_ID_RE.test(sessionId)) {
          conditions.push(like(usageEvent.metadata, `%"sessionId":"${sessionId}"%`));
        }
        if (q) {
          const safeQ = q.replace(/%/g, "\\%").replace(/_/g, "\\_");
          conditions.push(
            or(
              like(usageEvent.userEmail, `%${safeQ}%`),
              like(usageEvent.metadata, `%${safeQ}%`),
              like(usageEvent.errorCode, `%${safeQ}%`),
              like(usageEvent.model, `%${safeQ}%`),
            )!,
          );
        }
        if (startRaw) {
          const t = Date.parse(startRaw);
          if (!Number.isFinite(t))
            throw new APIError("BAD_REQUEST", { message: "Invalid start date" });
          conditions.push(gte(usageEvent.createdAt, new Date(t)));
        }
        if (endRaw) {
          const t = Date.parse(endRaw);
          if (!Number.isFinite(t))
            throw new APIError("BAD_REQUEST", { message: "Invalid end date" });
          conditions.push(lte(usageEvent.createdAt, new Date(t)));
        }

        const where = and(...conditions);
        const orderClause = sort === "asc" ? asc(usageEvent.createdAt) : desc(usageEvent.createdAt);

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
          metadata: usageEvent.metadata,
          createdAt: usageEvent.createdAt,
        };

        const [rows, totalRows, perActionRows] = await Promise.all([
          db.select(baseSelect).from(usageEvent).where(where).orderBy(orderClause).limit(limit).offset(offset),
          db.select({ total: count() }).from(usageEvent).where(where),
          db
            .select({
              action: usageEvent.action,
              events: count(),
              errors: sql<number>`COALESCE(SUM(CASE WHEN ${usageEvent.status} != 'ok' THEN 1 ELSE 0 END), 0)`,
            })
            .from(usageEvent)
            .where(where)
            .groupBy(usageEvent.action),
        ]);

        return ctx.json({
          events: rows,
          total: totalRows[0]?.total ?? 0,
          perAction: perActionRows,
          allowedActions: IMPORTANT_EVENT_ACTIONS,
          filters: {
            actions,
            userId: userId ?? null,
            status: status ?? null,
            sessionId: sessionId ?? null,
            q: q ?? null,
            start: startRaw ?? null,
            end: endRaw ?? null,
            sort,
          },
        });
      },
    ),
  };
}
