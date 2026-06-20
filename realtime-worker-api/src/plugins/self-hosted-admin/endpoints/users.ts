/** User CRUD, listing, bulk operations, and export. */

import { and, count, desc, eq, inArray, like, or } from "drizzle-orm";
import { APIError, createAuthEndpoint, sessionMiddleware } from "better-auth/api";
import {
  account,
  auditEvent,
  quotaBalance,
  savedNote,
  session,
  user,
  userInterviewContext,
  userModelParams,
} from "../../../db/schema";
import { getUserUsageSummary } from "../../../usage";
import {
  ensureQuotaRow,
  getQuotaForUser,
  toQuotaSummary,
} from "../../../services/quota.service";
import { SAFE_ID_RE } from "../constants";
import { parseLimit, parseOffset, sanitizeSearch } from "../helpers";
import {
  bulkApproveSchema,
  bulkBanSchema,
  bulkUserIdsSchema,
  deleteUserSchema,
  updateUserSchema,
} from "../schemas";
import type { AdminDeps } from "../types";

export function userEndpoints(deps: AdminDeps) {
  const { isAdmin, opts, recordAudit } = deps;
  return {
    adminListUsers: createAuthEndpoint(
      "/self-hosted-admin/list-users",
      { method: "GET", use: [sessionMiddleware] },
      async (ctx) => {
        if (!(await isAdmin(ctx.context.session.user.email)))
          throw new APIError("FORBIDDEN");
        const db = opts.getDb();
        const url = new URL(ctx.request?.url ?? "http://localhost");
        const limit = parseLimit(url.searchParams.get("limit"));
        const offset = parseOffset(url.searchParams.get("offset"));
        const q = sanitizeSearch(url.searchParams.get("q"));
        const filter = url.searchParams.get("filter");

        const baseSelect = {
          id: user.id,
          name: user.name,
          email: user.email,
          emailVerified: user.emailVerified,
          isApproved: user.isApproved,
          isBanned: user.isBanned,
          banReason: user.banReason,
          lastActiveAt: user.lastActiveAt,
          createdAt: user.createdAt,
          updatedAt: user.updatedAt,
        };

        const conditions: ReturnType<typeof eq>[] = [];
        if (q) {
          const safeQ = q.replace(/%/g, "\\%").replace(/_/g, "\\_");
          conditions.push(or(like(user.email, `%${safeQ}%`), like(user.name, `%${safeQ}%`))!);
        }
        if (filter === "pending") conditions.push(eq(user.isApproved, false));
        if (filter === "banned") conditions.push(eq(user.isBanned, true));
        if (filter === "approved") conditions.push(eq(user.isApproved, true));

        const where = conditions.length > 0 ? and(...conditions) : undefined;

        const [rows, [{ total }]] = await Promise.all([
          where
            ? db
                .select({
                  ...baseSelect,
                  planTier: quotaBalance.planTier,
                  consumedCompletions: quotaBalance.consumedCompletions,
                  monthlyAllowanceCompletions: quotaBalance.monthlyAllowanceCompletions,
                })
                .from(user)
                .leftJoin(quotaBalance, eq(user.id, quotaBalance.userId))
                .where(where)
                .orderBy(desc(user.createdAt))
                .limit(limit)
                .offset(offset)
            : db
                .select({
                  ...baseSelect,
                  planTier: quotaBalance.planTier,
                  consumedCompletions: quotaBalance.consumedCompletions,
                  monthlyAllowanceCompletions: quotaBalance.monthlyAllowanceCompletions,
                })
                .from(user)
                .leftJoin(quotaBalance, eq(user.id, quotaBalance.userId))
                .orderBy(desc(user.createdAt))
                .limit(limit)
                .offset(offset),
          where
            ? db.select({ total: count() }).from(user).where(where)
            : db.select({ total: count() }).from(user),
        ]);

        const users = rows.map((row) => {
          const {
            planTier,
            consumedCompletions,
            monthlyAllowanceCompletions,
            ...userRow
          } = row;
          return {
            ...userRow,
            quota:
              planTier != null ||
              consumedCompletions != null ||
              monthlyAllowanceCompletions != null
                ? {
                    planTier: planTier ?? null,
                    consumedCompletions: consumedCompletions ?? null,
                    monthlyAllowanceCompletions:
                      monthlyAllowanceCompletions ?? null,
                  }
                : null,
          };
        });

        return ctx.json({ users, total });
      },
    ),

    adminUpdateUser: createAuthEndpoint(
      "/self-hosted-admin/update-user",
      { method: "POST", use: [sessionMiddleware], body: updateUserSchema },
      async (ctx) => {
        const adminEmail = ctx.context.session.user.email;
        if (!(await isAdmin(adminEmail))) throw new APIError("FORBIDDEN");
        const db = opts.getDb();
        const { userId, isApproved, isBanned, banReason } = ctx.body;

        const [existing] = await db
          .select({ id: user.id, email: user.email })
          .from(user)
          .where(eq(user.id, userId));
        if (!existing) throw new APIError("NOT_FOUND", { message: "User not found" });

        const updates: Record<string, unknown> = { updatedAt: new Date() };

        if (isApproved !== undefined) {
          updates.isApproved = isApproved;
          await recordAudit({
            eventType: isApproved ? "user_approved" : "user_approval_revoked",
            userId,
            userEmail: existing.email,
            metadata: { adminEmail },
          });
        }
        if (isBanned !== undefined) {
          updates.isBanned = isBanned;
          if (isBanned && banReason) updates.banReason = banReason;
          if (!isBanned) updates.banReason = null;
          await recordAudit({
            eventType: isBanned ? "user_banned" : "user_unbanned",
            userId,
            userEmail: existing.email,
            metadata: { adminEmail, reason: isBanned ? banReason : undefined },
          });
        }

        await db.update(user).set(updates).where(eq(user.id, userId));
        return ctx.json({ ok: true });
      },
    ),

    adminDeleteUser: createAuthEndpoint(
      "/self-hosted-admin/delete-user",
      { method: "POST", use: [sessionMiddleware], body: deleteUserSchema },
      async (ctx) => {
        const adminEmail = ctx.context.session.user.email;
        if (!(await isAdmin(adminEmail))) throw new APIError("FORBIDDEN");
        const db = opts.getDb();
        const { userId } = ctx.body;
        if (userId === ctx.context.session.user.id)
          throw new APIError("BAD_REQUEST", { message: "Cannot delete your own account" });

        const [existing] = await db
          .select({ id: user.id, email: user.email })
          .from(user)
          .where(eq(user.id, userId));
        if (!existing) throw new APIError("NOT_FOUND", { message: "User not found" });

        await recordAudit({
          eventType: "user_deleted",
          userId,
          userEmail: existing.email,
          metadata: { adminEmail },
        });
        await db.delete(savedNote).where(eq(savedNote.userId, userId));
        await db.delete(userInterviewContext).where(eq(userInterviewContext.userId, userId));
        await db.delete(session).where(eq(session.userId, userId));
        await db.delete(account).where(eq(account.userId, userId));
        await db.delete(user).where(eq(user.id, userId));
        return ctx.json({ ok: true });
      },
    ),

    adminGetUser: createAuthEndpoint(
      "/self-hosted-admin/get-user",
      { method: "GET", use: [sessionMiddleware] },
      async (ctx) => {
        if (!(await isAdmin(ctx.context.session.user.email)))
          throw new APIError("FORBIDDEN");
        const db = opts.getDb();
        const url = new URL(ctx.request?.url ?? "http://localhost");
        const userId = url.searchParams.get("userId");
        if (!userId || !SAFE_ID_RE.test(userId))
          throw new APIError("BAD_REQUEST", { message: "Invalid userId" });

        const [targetUser] = await db.select().from(user).where(eq(user.id, userId));
        if (!targetUser) throw new APIError("NOT_FOUND", { message: "User not found" });

        const [sessions, notes, interviewContext, recentAudit, modelParamsRow] = await Promise.all([
          db
            .select({
              id: session.id,
              expiresAt: session.expiresAt,
              createdAt: session.createdAt,
              ipAddress: session.ipAddress,
              userAgent: session.userAgent,
            })
            .from(session)
            .where(eq(session.userId, userId))
            .orderBy(desc(session.createdAt))
            .limit(10),
          db.select({ total: count() }).from(savedNote).where(eq(savedNote.userId, userId)),
          db.select().from(userInterviewContext).where(eq(userInterviewContext.userId, userId)),
          db.select().from(auditEvent).where(eq(auditEvent.userId, userId)).orderBy(desc(auditEvent.createdAt)).limit(20),
          db.select().from(userModelParams).where(eq(userModelParams.userId, userId)),
        ]);
        const modelParamsOverride = modelParamsRow[0]
          ? {
              maxOutputTokens: modelParamsRow[0].maxOutputTokens,
              temperature: modelParamsRow[0].temperature,
              topP: modelParamsRow[0].topP,
              thinkingBudget: modelParamsRow[0].thinkingBudget,
              updatedAt: modelParamsRow[0].updatedAt,
            }
          : null;

        const usageSince = new Date(Date.now() - 30 * 86_400_000);
        const usageSummary = await getUserUsageSummary(db, userId, usageSince).catch((e) => {
          console.warn("[admin] usage summary failed", e);
          return {
            totals: { events: 0, promptChars: 0, responseChars: 0, durationMs: 0, errors: 0 },
            perAction: [],
          };
        });

        await ensureQuotaRow(db, userId);
        const quotaRow = await getQuotaForUser(db, userId);

        return ctx.json({
          user: targetUser,
          sessions,
          notesCount: notes[0]?.total ?? 0,
          hasInterviewContext: !!interviewContext[0],
          recentAuditEvents: recentAudit,
          modelParamsOverride,
          quota: toQuotaSummary(quotaRow, {} as import("../../../env").Env),
          usage: {
            window: "30d",
            since: usageSince.toISOString(),
            totals: usageSummary.totals,
            perAction: usageSummary.perAction,
          },
        });
      },
    ),

    adminExportUsers: createAuthEndpoint(
      "/self-hosted-admin/export-users",
      { method: "GET", use: [sessionMiddleware] },
      async (ctx) => {
        if (!(await isAdmin(ctx.context.session.user.email)))
          throw new APIError("FORBIDDEN");
        const db = opts.getDb();

        const rows = await db
          .select({
            id: user.id,
            name: user.name,
            email: user.email,
            isApproved: user.isApproved,
            isBanned: user.isBanned,
            createdAt: user.createdAt,
            lastActiveAt: user.lastActiveAt,
          })
          .from(user)
          .orderBy(desc(user.createdAt));

        const csvHeader = "id,name,email,isApproved,isBanned,createdAt,lastActiveAt";
        const csvRows = rows.map((r) => {
          const safeName = (r.name || "").replace(/"/g, '""');
          return `${r.id},"${safeName}",${r.email},${r.isApproved ?? false},${r.isBanned ?? false},${r.createdAt?.toISOString() ?? ""},${r.lastActiveAt?.toISOString() ?? ""}`;
        });

        return ctx.json({ csv: [csvHeader, ...csvRows].join("\n"), total: rows.length });
      },
    ),

    adminBulkApprove: createAuthEndpoint(
      "/self-hosted-admin/bulk-approve",
      { method: "POST", use: [sessionMiddleware], body: bulkApproveSchema },
      async (ctx) => {
        const adminEmail = ctx.context.session.user.email;
        if (!(await isAdmin(adminEmail))) throw new APIError("FORBIDDEN");
        const db = opts.getDb();
        const { userIds, approve } = ctx.body;

        await db
          .update(user)
          .set({ isApproved: approve, updatedAt: new Date() })
          .where(inArray(user.id, userIds));

        await recordAudit({
          eventType: approve ? "user_approved" : "user_approval_revoked",
          userEmail: adminEmail,
          metadata: { action: "bulk_approve", userIds, approve, count: userIds.length },
        });

        return ctx.json({ ok: true, affected: userIds.length });
      },
    ),

    adminBulkBan: createAuthEndpoint(
      "/self-hosted-admin/bulk-ban",
      { method: "POST", use: [sessionMiddleware], body: bulkBanSchema },
      async (ctx) => {
        const adminEmail = ctx.context.session.user.email;
        if (!(await isAdmin(adminEmail))) throw new APIError("FORBIDDEN");
        const db = opts.getDb();
        const { userIds, ban, banReason } = ctx.body;

        const updates: Record<string, unknown> = {
          isBanned: ban,
          updatedAt: new Date(),
        };
        if (ban && banReason) updates.banReason = banReason;
        if (!ban) updates.banReason = null;

        await db.update(user).set(updates).where(inArray(user.id, userIds));

        if (ban) {
          await db.delete(session).where(inArray(session.userId, userIds));
        }

        await recordAudit({
          eventType: ban ? "user_banned" : "user_unbanned",
          userEmail: adminEmail,
          metadata: { action: "bulk_ban", userIds, ban, banReason, count: userIds.length },
        });

        return ctx.json({ ok: true, affected: userIds.length });
      },
    ),

    adminBulkDelete: createAuthEndpoint(
      "/self-hosted-admin/bulk-delete",
      { method: "POST", use: [sessionMiddleware], body: bulkUserIdsSchema },
      async (ctx) => {
        const adminEmail = ctx.context.session.user.email;
        if (!(await isAdmin(adminEmail))) throw new APIError("FORBIDDEN");
        const db = opts.getDb();
        const { userIds } = ctx.body;

        const selfId = ctx.context.session.user.id;
        if (userIds.includes(selfId))
          throw new APIError("BAD_REQUEST", { message: "Cannot delete your own account" });

        await db.delete(savedNote).where(inArray(savedNote.userId, userIds));
        await db.delete(userInterviewContext).where(inArray(userInterviewContext.userId, userIds));
        await db.delete(session).where(inArray(session.userId, userIds));
        await db.delete(account).where(inArray(account.userId, userIds));
        await db.delete(user).where(inArray(user.id, userIds));

        await recordAudit({
          eventType: "user_deleted",
          userEmail: adminEmail,
          metadata: { action: "bulk_delete", userIds, count: userIds.length },
        });

        return ctx.json({ ok: true, affected: userIds.length });
      },
    ),
  };
}
