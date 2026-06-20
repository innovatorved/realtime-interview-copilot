/** Admin notes + presets management. */

import { and, asc, count, desc, eq, like } from "drizzle-orm";
import { APIError, createAuthEndpoint, sessionMiddleware } from "better-auth/api";
import { interviewPreset, presetUserContext, savedNote, user } from "../../../db/schema";
import { presetContextQuerySchema } from "../../../schemas/preset-context";
import { SAFE_ID_RE } from "../constants";
import { parseLimit, parseOffset, sanitizeSearch } from "../helpers";
import {
  adminCreatePresetSchema,
  adminDeleteNoteSchema,
  adminDeletePresetSchema,
  adminUpdatePresetSchema,
} from "../schemas";
import type { AdminDeps } from "../types";

export function notesPresetsEndpoints(deps: AdminDeps) {
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

    adminListPresets: createAuthEndpoint(
      "/self-hosted-admin/list-presets",
      { method: "GET", use: [sessionMiddleware] },
      async (ctx) => {
        if (!(await isAdmin(ctx.context.session.user.email)))
          throw new APIError("FORBIDDEN");
        const db = opts.getDb();
        const url = new URL(ctx.request?.url ?? "http://localhost");
        const limit = parseLimit(url.searchParams.get("limit"));
        const offset = parseOffset(url.searchParams.get("offset"));
        const category = url.searchParams.get("category");
        const builtInOnly = url.searchParams.get("builtIn");

        const conditions: ReturnType<typeof eq>[] = [];
        if (category) conditions.push(eq(interviewPreset.category, category));
        if (builtInOnly === "true") conditions.push(eq(interviewPreset.isBuiltIn, true));
        if (builtInOnly === "false") conditions.push(eq(interviewPreset.isBuiltIn, false));

        const where = conditions.length > 0 ? and(...conditions) : undefined;

        const [rows, [{ total }]] = await Promise.all([
          where
            ? db.select().from(interviewPreset).where(where).orderBy(asc(interviewPreset.name)).limit(limit).offset(offset)
            : db.select().from(interviewPreset).orderBy(asc(interviewPreset.name)).limit(limit).offset(offset),
          where
            ? db.select({ total: count() }).from(interviewPreset).where(where)
            : db.select({ total: count() }).from(interviewPreset),
        ]);

        return ctx.json({ presets: rows, total });
      },
    ),

    adminCreatePreset: createAuthEndpoint(
      "/self-hosted-admin/create-preset",
      { method: "POST", use: [sessionMiddleware], body: adminCreatePresetSchema },
      async (ctx) => {
        const adminEmail = ctx.context.session.user.email;
        if (!(await isAdmin(adminEmail))) throw new APIError("FORBIDDEN");
        const db = opts.getDb();
        const { name, category, context, description, icon, isBuiltIn, resumeText, resumeFileName, jobDescription } = ctx.body;

        const id = crypto.randomUUID();
        const now = new Date();
        await db.insert(interviewPreset).values({
          id,
          name,
          category,
          context,
          description: description ?? null,
          icon: icon ?? null,
          isBuiltIn: isBuiltIn ?? true,
          userId: null,
          resumeText: resumeText ?? null,
          resumeFileName: resumeFileName ?? null,
          jobDescription: jobDescription ?? null,
          createdAt: now,
          updatedAt: now,
        });

        await recordAudit({
          eventType: "admin_action",
          userEmail: adminEmail,
          metadata: { action: "create_preset", presetId: id, name },
        });
        return ctx.json({ ok: true, presetId: id });
      },
    ),

    adminUpdatePreset: createAuthEndpoint(
      "/self-hosted-admin/update-preset",
      { method: "POST", use: [sessionMiddleware], body: adminUpdatePresetSchema },
      async (ctx) => {
        const adminEmail = ctx.context.session.user.email;
        if (!(await isAdmin(adminEmail))) throw new APIError("FORBIDDEN");
        const db = opts.getDb();
        const { presetId, ...fields } = ctx.body;

        const [existing] = await db
          .select({ id: interviewPreset.id })
          .from(interviewPreset)
          .where(eq(interviewPreset.id, presetId));
        if (!existing) throw new APIError("NOT_FOUND", { message: "Preset not found" });

        const updates: Record<string, unknown> = {};
        if (fields.name !== undefined) updates.name = fields.name;
        if (fields.category !== undefined) updates.category = fields.category;
        if (fields.context !== undefined) updates.context = fields.context;
        if (fields.description !== undefined) updates.description = fields.description;
        if (fields.icon !== undefined) updates.icon = fields.icon;
        if (fields.resumeText !== undefined) updates.resumeText = fields.resumeText;
        if (fields.resumeFileName !== undefined) updates.resumeFileName = fields.resumeFileName;
        if (fields.jobDescription !== undefined) updates.jobDescription = fields.jobDescription;
        if (Object.keys(updates).length > 0) {
          updates.updatedAt = new Date();
          await db.update(interviewPreset).set(updates).where(eq(interviewPreset.id, presetId));
        }

        await recordAudit({
          eventType: "admin_action",
          userEmail: adminEmail,
          metadata: { action: "update_preset", presetId },
        });
        return ctx.json({ ok: true });
      },
    ),

    adminDeletePreset: createAuthEndpoint(
      "/self-hosted-admin/delete-preset",
      { method: "POST", use: [sessionMiddleware], body: adminDeletePresetSchema },
      async (ctx) => {
        const adminEmail = ctx.context.session.user.email;
        if (!(await isAdmin(adminEmail))) throw new APIError("FORBIDDEN");
        const db = opts.getDb();
        const { presetId } = ctx.body;

        await db.delete(interviewPreset).where(eq(interviewPreset.id, presetId));
        await recordAudit({
          eventType: "admin_action",
          userEmail: adminEmail,
          metadata: { action: "delete_preset", presetId },
        });
        return ctx.json({ ok: true });
      },
    ),

    adminGetPresetContext: createAuthEndpoint(
      "/self-hosted-admin/preset-context",
      { method: "GET", use: [sessionMiddleware] },
      async (ctx) => {
        if (!(await isAdmin(ctx.context.session.user.email)))
          throw new APIError("FORBIDDEN");
        const db = opts.getDb();
        const url = new URL(ctx.request?.url ?? "http://localhost");
        const parsed = presetContextQuerySchema.safeParse({
          userId: url.searchParams.get("userId"),
          presetId: url.searchParams.get("presetId"),
        });
        if (!parsed.success) {
          throw new APIError("BAD_REQUEST", { message: "Invalid userId or presetId" });
        }
        const { userId, presetId } = parsed.data;

        const [preset] = await db
          .select()
          .from(interviewPreset)
          .where(eq(interviewPreset.id, presetId));
        if (!preset) throw new APIError("NOT_FOUND", { message: "Preset not found" });

        if (preset.isBuiltIn) {
          const [overlay] = await db
            .select()
            .from(presetUserContext)
            .where(
              and(
                eq(presetUserContext.userId, userId),
                eq(presetUserContext.presetId, presetId),
              ),
            );
          return ctx.json({
            userId,
            presetId,
            overlay: overlay
              ? {
                  resumeText: overlay.resumeText,
                  resumeFileName: overlay.resumeFileName,
                  jobDescription: overlay.jobDescription,
                  updatedAt: overlay.updatedAt,
                }
              : null,
          });
        }

        if (preset.userId !== userId) {
          return ctx.json({
            userId,
            presetId,
            overlay: null,
          });
        }

        return ctx.json({
          userId,
          presetId,
          overlay: {
            resumeText: preset.resumeText,
            resumeFileName: preset.resumeFileName,
            jobDescription: preset.jobDescription,
            updatedAt: preset.updatedAt,
          },
        });
      },
    ),
  };
}
