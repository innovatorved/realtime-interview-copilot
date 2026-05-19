/** Admin announcements CRUD + stats. */

import { and, count, desc, eq, inArray } from "drizzle-orm";
import { APIError, createAuthEndpoint, sessionMiddleware } from "better-auth/api";
import { appAnnouncement, appAnnouncementDismissal, user } from "../../../db/schema";
import { SAFE_ID_RE } from "../constants";
import { parseLimit, parseOffset } from "../helpers";
import {
  announcementCreateSchema,
  announcementIdSchema,
  announcementUpdateSchema,
} from "../schemas";
import type { AdminDeps } from "../types";

export function announcementEndpoints(deps: AdminDeps) {
  const { isAdmin, opts, recordAudit } = deps;
  return {
    adminAnnouncementsList: createAuthEndpoint(
      "/self-hosted-admin/announcements",
      { method: "GET", use: [sessionMiddleware] },
      async (ctx) => {
        if (!(await isAdmin(ctx.context.session.user.email)))
          throw new APIError("FORBIDDEN");
        const db = opts.getDb();
        const url = new URL(ctx.request?.url ?? "http://localhost");
        const limit = parseLimit(url.searchParams.get("limit"));
        const offset = parseOffset(url.searchParams.get("offset"));
        const statusRaw = url.searchParams.get("status");
        const kindRaw = url.searchParams.get("kind");

        const conditions: ReturnType<typeof eq>[] = [];
        if (statusRaw && /^(active|paused|archived)$/.test(statusRaw)) {
          conditions.push(eq(appAnnouncement.status, statusRaw));
        }
        if (kindRaw && /^(banner|popup|toast)$/.test(kindRaw)) {
          conditions.push(eq(appAnnouncement.kind, kindRaw));
        }
        const where = conditions.length > 0 ? and(...conditions) : undefined;

        const [rows, totalRows] = await Promise.all([
          where
            ? db.select().from(appAnnouncement).where(where).orderBy(desc(appAnnouncement.createdAt)).limit(limit).offset(offset)
            : db.select().from(appAnnouncement).orderBy(desc(appAnnouncement.createdAt)).limit(limit).offset(offset),
          where
            ? db.select({ total: count() }).from(appAnnouncement).where(where)
            : db.select({ total: count() }).from(appAnnouncement),
        ]);

        return ctx.json({
          announcements: rows,
          total: totalRows[0]?.total ?? 0,
          pagination: { limit, offset },
        });
      },
    ),

    adminAnnouncementsCreate: createAuthEndpoint(
      "/self-hosted-admin/announcements/create",
      { method: "POST", use: [sessionMiddleware], body: announcementCreateSchema },
      async (ctx) => {
        const adminEmail = ctx.context.session.user.email;
        if (!(await isAdmin(adminEmail))) throw new APIError("FORBIDDEN");
        const db = opts.getDb();
        const v = ctx.body;

        let targetUserIdsJson: string | null = null;
        if (v.audience === "users" && v.targetUserIds && v.targetUserIds.length > 0) {
          const existing = await db
            .select({ id: user.id })
            .from(user)
            .where(inArray(user.id, v.targetUserIds));
          const found = new Set(existing.map((r) => r.id));
          const valid = v.targetUserIds.filter((id) => found.has(id));
          if (valid.length === 0) {
            throw new APIError("BAD_REQUEST", { message: "None of targetUserIds exist" });
          }
          targetUserIdsJson = JSON.stringify(valid);
        }

        const id = crypto.randomUUID();
        const now = new Date();
        await db.insert(appAnnouncement).values({
          id,
          kind: v.kind,
          severity: v.severity,
          title: v.title ?? null,
          body: v.body,
          ctaLabel: v.ctaLabel ?? null,
          ctaUrl: v.ctaUrl ?? null,
          audience: v.audience,
          targetUserIds: targetUserIdsJson,
          status: v.status,
          dismissable: v.dismissable ? 1 : 0,
          startsAt: v.startsAt ? new Date(v.startsAt) : null,
          expiresAt: v.expiresAt ? new Date(v.expiresAt) : null,
          createdBy: adminEmail,
          createdAt: now,
          updatedAt: now,
        });

        await recordAudit({
          eventType: "admin_action",
          userEmail: adminEmail,
          metadata: {
            action: "announcement_create",
            id,
            kind: v.kind,
            audience: v.audience,
          },
        });

        return ctx.json({ ok: true, id });
      },
    ),

    adminAnnouncementsUpdate: createAuthEndpoint(
      "/self-hosted-admin/announcements/update",
      { method: "POST", use: [sessionMiddleware], body: announcementUpdateSchema },
      async (ctx) => {
        const adminEmail = ctx.context.session.user.email;
        if (!(await isAdmin(adminEmail))) throw new APIError("FORBIDDEN");
        const db = opts.getDb();
        const { id, ...fields } = ctx.body;

        const [existing] = await db
          .select()
          .from(appAnnouncement)
          .where(eq(appAnnouncement.id, id))
          .limit(1);
        if (!existing) throw new APIError("NOT_FOUND", { message: "Announcement not found" });

        const updates: Record<string, unknown> = { updatedAt: new Date() };
        if (fields.kind !== undefined) updates.kind = fields.kind;
        if (fields.severity !== undefined) updates.severity = fields.severity;
        if (fields.title !== undefined) updates.title = fields.title;
        if (fields.body !== undefined) updates.body = fields.body;
        if (fields.ctaLabel !== undefined) updates.ctaLabel = fields.ctaLabel;
        if (fields.ctaUrl !== undefined) updates.ctaUrl = fields.ctaUrl;
        if (fields.status !== undefined) updates.status = fields.status;
        if (fields.dismissable !== undefined)
          updates.dismissable = fields.dismissable ? 1 : 0;
        if (fields.startsAt !== undefined) {
          updates.startsAt = fields.startsAt ? new Date(fields.startsAt) : null;
        }
        if (fields.expiresAt !== undefined) {
          updates.expiresAt = fields.expiresAt ? new Date(fields.expiresAt) : null;
        }

        // Audience + targetUserIds change as a pair so we never end
        // up with audience='users' and an empty list.
        if (fields.audience !== undefined || fields.targetUserIds !== undefined) {
          const newAudience = fields.audience ?? existing.audience;
          if (newAudience === "users") {
            const ids =
              fields.targetUserIds ??
              (existing.targetUserIds ? (JSON.parse(existing.targetUserIds) as string[]) : []);
            if (!Array.isArray(ids) || ids.length === 0) {
              throw new APIError("BAD_REQUEST", {
                message: "audience='users' requires non-empty targetUserIds",
              });
            }
            const verified = await db
              .select({ id: user.id })
              .from(user)
              .where(inArray(user.id, ids));
            const valid = new Set(verified.map((r) => r.id));
            const filtered = ids.filter((u) => valid.has(u));
            if (filtered.length === 0) {
              throw new APIError("BAD_REQUEST", { message: "None of targetUserIds exist" });
            }
            updates.audience = "users";
            updates.targetUserIds = JSON.stringify(filtered);
          } else if (newAudience === "all") {
            updates.audience = "all";
            updates.targetUserIds = null;
          }
        }

        await db.update(appAnnouncement).set(updates).where(eq(appAnnouncement.id, id));

        await recordAudit({
          eventType: "admin_action",
          userEmail: adminEmail,
          metadata: { action: "announcement_update", id, updated: Object.keys(updates) },
        });

        return ctx.json({ ok: true });
      },
    ),

    adminAnnouncementsDelete: createAuthEndpoint(
      "/self-hosted-admin/announcements/delete",
      { method: "POST", use: [sessionMiddleware], body: announcementIdSchema },
      async (ctx) => {
        const adminEmail = ctx.context.session.user.email;
        if (!(await isAdmin(adminEmail))) throw new APIError("FORBIDDEN");
        const db = opts.getDb();
        const { id } = ctx.body;
        // Dismissals cascade via FK ON DELETE CASCADE.
        await db.delete(appAnnouncement).where(eq(appAnnouncement.id, id));
        await recordAudit({
          eventType: "admin_action",
          userEmail: adminEmail,
          metadata: { action: "announcement_delete", id },
        });
        return ctx.json({ ok: true });
      },
    ),

    adminAnnouncementsStats: createAuthEndpoint(
      "/self-hosted-admin/announcements/stats",
      { method: "GET", use: [sessionMiddleware] },
      async (ctx) => {
        if (!(await isAdmin(ctx.context.session.user.email)))
          throw new APIError("FORBIDDEN");
        const db = opts.getDb();
        const url = new URL(ctx.request?.url ?? "http://localhost");
        const id = url.searchParams.get("id") ?? "";
        if (!SAFE_ID_RE.test(id)) {
          throw new APIError("BAD_REQUEST", { message: "Invalid id" });
        }

        const [{ dismissed }] = await db
          .select({ dismissed: count() })
          .from(appAnnouncementDismissal)
          .where(eq(appAnnouncementDismissal.announcementId, id));

        return ctx.json({ id, dismissed });
      },
    ),
  };
}
