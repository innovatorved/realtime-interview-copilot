/** Admin support inbox: threads list, thread detail, reply, status, delete. */

import { and, asc, count, desc, eq, isNull, like, or } from "drizzle-orm";
import { APIError, createAuthEndpoint, sessionMiddleware } from "better-auth/api";
import { supportMessage } from "../../../db/schema";
import { SAFE_ID_RE } from "../constants";
import { parseLimit, parseOffset, sanitizeSearch } from "../helpers";
import {
  supportDeleteSchema,
  supportReplySchema,
  supportUpdateStatusSchema,
} from "../schemas";
import type { AdminDeps } from "../types";

export function supportEndpoints(deps: AdminDeps) {
  const { isAdmin, opts, recordAudit } = deps;
  return {
    adminSupportListThreads: createAuthEndpoint(
      "/self-hosted-admin/support/threads",
      { method: "GET", use: [sessionMiddleware] },
      async (ctx) => {
        if (!(await isAdmin(ctx.context.session.user.email)))
          throw new APIError("FORBIDDEN");
        const db = opts.getDb();
        const url = new URL(ctx.request?.url ?? "http://localhost");
        const limit = parseLimit(url.searchParams.get("limit"));
        const offset = parseOffset(url.searchParams.get("offset"));
        const statusRaw = url.searchParams.get("status");
        const unreadOnly = url.searchParams.get("unreadOnly") === "true";
        const userId = url.searchParams.get("userId");
        const q = sanitizeSearch(url.searchParams.get("q"));

        const conditions: ReturnType<typeof eq>[] = [isNull(supportMessage.parentId)];
        if (statusRaw && /^(open|pending|resolved)$/.test(statusRaw)) {
          conditions.push(eq(supportMessage.status, statusRaw));
        }
        if (unreadOnly) conditions.push(eq(supportMessage.unreadByAdmin, 1));
        if (userId && SAFE_ID_RE.test(userId)) {
          conditions.push(eq(supportMessage.userId, userId));
        }
        if (q) {
          const safeQ = q.replace(/%/g, "\\%").replace(/_/g, "\\_");
          conditions.push(
            or(
              like(supportMessage.body, `%${safeQ}%`),
              like(supportMessage.subject, `%${safeQ}%`),
              like(supportMessage.userEmail, `%${safeQ}%`),
              like(supportMessage.userName, `%${safeQ}%`),
            )!,
          );
        }

        const where = and(...conditions);

        const baseSelect = {
          id: supportMessage.id,
          userId: supportMessage.userId,
          userEmail: supportMessage.userEmail,
          userName: supportMessage.userName,
          subject: supportMessage.subject,
          body: supportMessage.body,
          status: supportMessage.status,
          unreadByAdmin: supportMessage.unreadByAdmin,
          unreadByUser: supportMessage.unreadByUser,
          ipAddress: supportMessage.ipAddress,
          createdAt: supportMessage.createdAt,
          updatedAt: supportMessage.updatedAt,
        };

        const [rows, totalRows, unreadCountRows] = await Promise.all([
          db
            .select(baseSelect)
            .from(supportMessage)
            .where(where)
            .orderBy(desc(supportMessage.updatedAt))
            .limit(limit)
            .offset(offset),
          db.select({ total: count() }).from(supportMessage).where(where),
          db
            .select({ unread: count() })
            .from(supportMessage)
            .where(
              and(
                isNull(supportMessage.parentId),
                eq(supportMessage.unreadByAdmin, 1),
              ),
            ),
        ]);

        return ctx.json({
          threads: rows,
          total: totalRows[0]?.total ?? 0,
          totalUnread: unreadCountRows[0]?.unread ?? 0,
          pagination: { limit, offset },
        });
      },
    ),

    adminSupportGetThread: createAuthEndpoint(
      "/self-hosted-admin/support/thread",
      { method: "GET", use: [sessionMiddleware] },
      async (ctx) => {
        const adminEmail = ctx.context.session.user.email;
        if (!(await isAdmin(adminEmail))) throw new APIError("FORBIDDEN");
        const db = opts.getDb();
        const url = new URL(ctx.request?.url ?? "http://localhost");
        const id = url.searchParams.get("id") ?? "";
        if (!SAFE_ID_RE.test(id)) {
          throw new APIError("BAD_REQUEST", { message: "Invalid id" });
        }

        const [root] = await db
          .select()
          .from(supportMessage)
          .where(eq(supportMessage.id, id))
          .limit(1);
        if (!root) throw new APIError("NOT_FOUND", { message: "Thread not found" });
        if (root.parentId !== null) {
          throw new APIError("BAD_REQUEST", { message: "id must point at a thread root" });
        }

        const messages = await db
          .select()
          .from(supportMessage)
          .where(
            or(eq(supportMessage.id, id), eq(supportMessage.parentId, id))!,
          )
          .orderBy(asc(supportMessage.createdAt));

        // Mark thread as read by admin (best-effort — we never block on this).
        if (root.unreadByAdmin) {
          try {
            await db
              .update(supportMessage)
              .set({ unreadByAdmin: 0, updatedAt: new Date() })
              .where(eq(supportMessage.id, id));
          } catch (e) {
            console.warn("[admin] support read-mark failed:", e);
          }
        }

        return ctx.json({
          thread: { ...root, unreadByAdmin: false },
          messages,
        });
      },
    ),

    adminSupportReply: createAuthEndpoint(
      "/self-hosted-admin/support/reply",
      { method: "POST", use: [sessionMiddleware], body: supportReplySchema },
      async (ctx) => {
        const adminEmail = ctx.context.session.user.email;
        if (!(await isAdmin(adminEmail))) throw new APIError("FORBIDDEN");
        const db = opts.getDb();
        const { threadId, body, closeAfter } = ctx.body;

        const [root] = await db
          .select({
            id: supportMessage.id,
            userId: supportMessage.userId,
            parentId: supportMessage.parentId,
          })
          .from(supportMessage)
          .where(eq(supportMessage.id, threadId))
          .limit(1);
        if (!root) throw new APIError("NOT_FOUND", { message: "Thread not found" });
        if (root.parentId !== null) {
          throw new APIError("BAD_REQUEST", { message: "threadId must be a root id" });
        }

        const id = crypto.randomUUID();
        const now = new Date();
        await db.insert(supportMessage).values({
          id,
          userId: root.userId,
          userEmail: null,
          userName: null,
          parentId: threadId,
          authorType: "admin",
          authorEmail: adminEmail,
          subject: null,
          body,
          status: "reply",
          // Reply rows themselves don't drive the unread badge — the
          // root row's unreadByUser flag does.
          unreadByAdmin: 0,
          unreadByUser: 0,
          createdAt: now,
          updatedAt: now,
        });

        await db
          .update(supportMessage)
          .set({
            status: closeAfter ? "resolved" : "pending",
            unreadByUser: 1,
            unreadByAdmin: 0,
            updatedAt: now,
          })
          .where(eq(supportMessage.id, threadId));

        await recordAudit({
          eventType: "admin_action",
          userEmail: adminEmail,
          metadata: {
            action: "support_reply",
            threadId,
            replyId: id,
            closed: Boolean(closeAfter),
          },
        });

        return ctx.json({
          ok: true,
          replyId: id,
          createdAt: now.toISOString(),
        });
      },
    ),

    adminSupportUpdateStatus: createAuthEndpoint(
      "/self-hosted-admin/support/update-status",
      { method: "POST", use: [sessionMiddleware], body: supportUpdateStatusSchema },
      async (ctx) => {
        const adminEmail = ctx.context.session.user.email;
        if (!(await isAdmin(adminEmail))) throw new APIError("FORBIDDEN");
        const db = opts.getDb();
        const { threadId, status } = ctx.body;

        const [root] = await db
          .select({ id: supportMessage.id, parentId: supportMessage.parentId })
          .from(supportMessage)
          .where(eq(supportMessage.id, threadId))
          .limit(1);
        if (!root) throw new APIError("NOT_FOUND", { message: "Thread not found" });
        if (root.parentId !== null) {
          throw new APIError("BAD_REQUEST", { message: "threadId must be a root id" });
        }

        await db
          .update(supportMessage)
          .set({ status, updatedAt: new Date() })
          .where(eq(supportMessage.id, threadId));

        await recordAudit({
          eventType: "admin_action",
          userEmail: adminEmail,
          metadata: { action: "support_update_status", threadId, status },
        });

        return ctx.json({ ok: true });
      },
    ),

    adminSupportDelete: createAuthEndpoint(
      "/self-hosted-admin/support/delete",
      { method: "POST", use: [sessionMiddleware], body: supportDeleteSchema },
      async (ctx) => {
        const adminEmail = ctx.context.session.user.email;
        if (!(await isAdmin(adminEmail))) throw new APIError("FORBIDDEN");
        const db = opts.getDb();
        const { threadId } = ctx.body;

        // The schema's parentId column does not have ON DELETE CASCADE
        // (legacy reasons), so we delete replies explicitly first to
        // avoid orphan rows.
        await db.delete(supportMessage).where(eq(supportMessage.parentId, threadId));
        await db.delete(supportMessage).where(eq(supportMessage.id, threadId));

        await recordAudit({
          eventType: "admin_action",
          userEmail: adminEmail,
          metadata: { action: "support_delete", threadId },
        });
        return ctx.json({ ok: true });
      },
    ),
  };
}
