/** System-level stats export (CSV + JSON). */

import { count, eq, gte } from "drizzle-orm";
import { APIError, createAuthEndpoint, sessionMiddleware } from "better-auth/api";
import {
  auditEvent,
  savedNote,
  securityEvent,
  session,
  user,
  userInterviewContext,
} from "../../../db/schema";
import type { AdminDeps } from "../types";

export function exportsEndpoints(deps: AdminDeps) {
  const { isAdmin, opts } = deps;
  return {
    adminExportStats: createAuthEndpoint(
      "/self-hosted-admin/export-stats",
      { method: "GET", use: [sessionMiddleware] },
      async (ctx) => {
        if (!(await isAdmin(ctx.context.session.user.email)))
          throw new APIError("FORBIDDEN");
        const db = opts.getDb();
        const now = new Date();
        const dayAgo = new Date(now.getTime() - 86_400_000);
        const weekAgo = new Date(now.getTime() - 7 * 86_400_000);
        const monthAgo = new Date(now.getTime() - 30 * 86_400_000);

        const [
          [{ totalUsers }],
          [{ newUsers24h }],
          [{ newUsersWeek }],
          [{ newUsersMonth }],
          [{ pendingApproval }],
          [{ bannedUsers }],
          [{ activeSessions }],
          [{ totalNotes }],
          [{ totalInterviewContexts }],
          [{ totalAuditEvents }],
          [{ securityBlocks24h }],
          [{ securityBlocksWeek }],
        ] = await Promise.all([
          db.select({ totalUsers: count() }).from(user),
          db.select({ newUsers24h: count() }).from(user).where(gte(user.createdAt, dayAgo)),
          db.select({ newUsersWeek: count() }).from(user).where(gte(user.createdAt, weekAgo)),
          db.select({ newUsersMonth: count() }).from(user).where(gte(user.createdAt, monthAgo)),
          db.select({ pendingApproval: count() }).from(user).where(eq(user.isApproved, false)),
          db.select({ bannedUsers: count() }).from(user).where(eq(user.isBanned, true)),
          db.select({ activeSessions: count() }).from(session).where(gte(session.expiresAt, now)),
          db.select({ totalNotes: count() }).from(savedNote),
          db.select({ totalInterviewContexts: count() }).from(userInterviewContext),
          db.select({ totalAuditEvents: count() }).from(auditEvent),
          db.select({ securityBlocks24h: count() }).from(securityEvent).where(gte(securityEvent.createdAt, dayAgo)),
          db.select({ securityBlocksWeek: count() }).from(securityEvent).where(gte(securityEvent.createdAt, weekAgo)),
        ]);

        const csvLines = [
          "metric,value",
          `total_users,${totalUsers}`,
          `new_users_24h,${newUsers24h}`,
          `new_users_week,${newUsersWeek}`,
          `new_users_month,${newUsersMonth}`,
          `pending_approval,${pendingApproval}`,
          `banned_users,${bannedUsers}`,
          `active_sessions,${activeSessions}`,
          `total_notes,${totalNotes}`,
          `total_interview_contexts,${totalInterviewContexts}`,
          `total_audit_events,${totalAuditEvents}`,
          `security_blocks_24h,${securityBlocks24h}`,
          `security_blocks_week,${securityBlocksWeek}`,
          `exported_at,${now.toISOString()}`,
        ];

        return ctx.json({
          stats: {
            totalUsers,
            newUsers24h,
            newUsersWeek,
            newUsersMonth,
            pendingApproval,
            bannedUsers,
            activeSessions,
            totalNotes,
            totalInterviewContexts,
            totalAuditEvents,
            securityBlocks24h,
            securityBlocksWeek,
          },
          csv: csvLines.join("\n"),
          exportedAt: now.toISOString(),
        });
      },
    ),
  };
}
