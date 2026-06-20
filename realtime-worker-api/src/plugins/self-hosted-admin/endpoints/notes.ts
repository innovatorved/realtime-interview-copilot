/** Admin saved-notes management. */

import { and, count, desc, eq, like } from "drizzle-orm";
import { APIError, createAuthEndpoint, sessionMiddleware } from "better-auth/api";
import { savedNote, user, userInterviewContext } from "../../../db/schema";
import { adminUserInterviewContextQuerySchema } from "../../../schemas/interview-context";
import { SAFE_ID_RE } from "../constants";
import { parseLimit, parseOffset, sanitizeSearch } from "../helpers";
import { adminDeleteNoteSchema } from "../schemas";
import type { AdminDeps } from "../types";

export function notesEndpoints(deps: AdminDeps) {
  const { isAdmin, opts, recordAudit } = deps;
  return {
    adminListNotes: createAuthEndpoint(
      "/self-hosted-admin/list-notes",
      { method: "GET", use: [sessionMiddleware] },
      async (ctx) => {
        if (!(await isAdmin(ctx.context.session.user.email)))
          throw new APIError("FORBIDDEN");
        const db = opts.getDb();
        const url = new URL(ctx.request?.url ?? "http://localhost");
        const limit = parseLimit(url.searchParams.get("limit"));
        const offset = parseOffset(url.searchParams.get("offset"));
        const q = sanitizeSearch(url.searchParams.get("q"));
        const userId = url.searchParams.get("userId");

        const conditions: ReturnType<typeof eq>[] = [];
        if (q) {
          const safeQ = q.replace(/%/g, "\\%").replace(/_/g, "\\_");
          conditions.push(like(savedNote.content, `%${safeQ}%`));
        }
        if (userId && SAFE_ID_RE.test(userId)) conditions.push(eq(savedNote.userId, userId));

        const where = conditions.length > 0 ? and(...conditions) : undefined;

        const baseSelect = {
          id: savedNote.id,
          userId: savedNote.userId,
          content: savedNote.content,
          tag: savedNote.tag,
          createdAt: savedNote.createdAt,
          userEmail: user.email,
          userName: user.name,
        };

        const [rows, [{ total }]] = await Promise.all([
          where
            ? db
                .select(baseSelect)
                .from(savedNote)
                .leftJoin(user, eq(savedNote.userId, user.id))
                .where(where)
                .orderBy(desc(savedNote.createdAt))
                .limit(limit)
                .offset(offset)
            : db
                .select(baseSelect)
                .from(savedNote)
                .leftJoin(user, eq(savedNote.userId, user.id))
                .orderBy(desc(savedNote.createdAt))
                .limit(limit)
                .offset(offset),
          where
            ? db.select({ total: count() }).from(savedNote).where(where)
            : db.select({ total: count() }).from(savedNote),
        ]);

        return ctx.json({ notes: rows, total });
      },
    ),

    adminDeleteNote: createAuthEndpoint(
      "/self-hosted-admin/delete-note",
      { method: "POST", use: [sessionMiddleware], body: adminDeleteNoteSchema },
      async (ctx) => {
        const adminEmail = ctx.context.session.user.email;
        if (!(await isAdmin(adminEmail))) throw new APIError("FORBIDDEN");
        const db = opts.getDb();
        const { noteId } = ctx.body;

        await db.delete(savedNote).where(eq(savedNote.id, noteId));
        await recordAudit({
          eventType: "admin_action",
          userEmail: adminEmail,
          metadata: { action: "delete_note", noteId },
        });
        return ctx.json({ ok: true });
      },
    ),

    adminGetUserInterviewContext: createAuthEndpoint(
      "/self-hosted-admin/user-interview-context",
      { method: "GET", use: [sessionMiddleware] },
      async (ctx) => {
        if (!(await isAdmin(ctx.context.session.user.email)))
          throw new APIError("FORBIDDEN");
        const db = opts.getDb();
        const url = new URL(ctx.request?.url ?? "http://localhost");
        const parsed = adminUserInterviewContextQuerySchema.safeParse({
          userId: url.searchParams.get("userId"),
        });
        if (!parsed.success) {
          throw new APIError("BAD_REQUEST", { message: "Invalid userId" });
        }
        const { userId } = parsed.data;

        const [row] = await db
          .select()
          .from(userInterviewContext)
          .where(eq(userInterviewContext.userId, userId));

        return ctx.json({
          userId,
          context: row
            ? {
                interviewNotes: row.interviewNotes,
                resumeText: row.resumeText,
                resumeFileName: row.resumeFileName,
                jobDescription: row.jobDescription,
                updatedAt: row.updatedAt,
              }
            : null,
        });
      },
    ),
  };
}
