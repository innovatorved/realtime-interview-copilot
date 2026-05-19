/** /api/announcements/* — banners, popups, dismissals, acks. */

import { and, desc, eq, gte, inArray, isNull, lte, or } from "drizzle-orm";
import { getDb } from "../db";
import { appAnnouncement, appAnnouncementDismissal } from "../db/schema";
import {
  authErrorResponse,
  getAuthenticatedUserAllowPending,
  isAuthed,
} from "../middleware/auth";
import { jsonResponse } from "../lib/http";
import { SAFE_RESOURCE_ID_RE } from "../lib/ids";
import { recordUsage } from "../usage";
import type { Env } from "../env";

const ANNOUNCEMENT_KIND_VALUES = new Set(["banner", "popup", "toast"]);

export async function handleActiveAnnouncements(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  // Approved users get the full set; pending users are shown announcements
  // too because the "your account is being reviewed" notice still applies
  // to them. Banned users are blocked.
  const authResult = await getAuthenticatedUserAllowPending(request, env);
  if (!isAuthed(authResult)) return authErrorResponse(authResult.error);
  const user = authResult;

  void ctx;

  const url = new URL(request.url);
  const kindRaw = url.searchParams.get("kind");
  const filterKind =
    kindRaw && ANNOUNCEMENT_KIND_VALUES.has(kindRaw) ? kindRaw : null;

  const now = new Date();
  const db = getDb(env);

  const conditions = [eq(appAnnouncement.status, "active")];
  if (filterKind) conditions.push(eq(appAnnouncement.kind, filterKind));

  // Time window: a row matches when `startsAt IS NULL OR startsAt <= now`
  // AND `expiresAt IS NULL OR expiresAt > now`.
  conditions.push(
    or(
      isNull(appAnnouncement.startsAt),
      lte(appAnnouncement.startsAt, now),
    )!,
  );
  conditions.push(
    or(
      isNull(appAnnouncement.expiresAt),
      gte(appAnnouncement.expiresAt, now),
    )!,
  );

  const candidates = await db
    .select()
    .from(appAnnouncement)
    .where(and(...conditions))
    .orderBy(desc(appAnnouncement.createdAt))
    .limit(200);

  // Filter by audience in JS — JSON_LIKE on a small list is faster than
  // an SQL JSON parse on every row, and we already capped the candidate
  // set above. Then exclude popups the user has already dismissed.
  const targeted = candidates.filter((a) => {
    if (a.audience === "all") return true;
    if (a.audience === "users") {
      try {
        const ids = JSON.parse(a.targetUserIds ?? "[]");
        return Array.isArray(ids) && ids.includes(user.id);
      } catch {
        return false;
      }
    }
    return false;
  });

  if (targeted.length === 0) {
    return jsonResponse({ announcements: [] });
  }

  const ids = targeted.map((a) => a.id);
  const dismissals = await db
    .select({
      announcementId: appAnnouncementDismissal.announcementId,
    })
    .from(appAnnouncementDismissal)
    .where(
      and(
        eq(appAnnouncementDismissal.userId, user.id),
        inArray(appAnnouncementDismissal.announcementId, ids),
      ),
    );
  const dismissedIds = new Set(dismissals.map((d) => d.announcementId));

  const visible = targeted.filter((a) => !dismissedIds.has(a.id));

  return jsonResponse({
    announcements: visible.map(serializeAnnouncement),
  });
}

export async function handleDismissAnnouncement(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  id: string,
): Promise<Response> {
  const authResult = await getAuthenticatedUserAllowPending(request, env);
  if (!isAuthed(authResult)) return authErrorResponse(authResult.error);
  const user = authResult;

  void ctx;

  if (!SAFE_RESOURCE_ID_RE.test(id)) {
    return jsonResponse({ error: "Invalid announcement id" }, 400);
  }

  const db = getDb(env);

  const [row] = await db
    .select({
      id: appAnnouncement.id,
      dismissable: appAnnouncement.dismissable,
    })
    .from(appAnnouncement)
    .where(eq(appAnnouncement.id, id))
    .limit(1);

  if (!row) return jsonResponse({ error: "Announcement not found" }, 404);
  if (!row.dismissable) {
    return jsonResponse(
      { error: "This announcement cannot be dismissed" },
      403,
    );
  }

  // INSERT OR IGNORE — duplicate dismissals must be a no-op.
  // Raw D1 prepare is deliberate here (matches the legacy pattern); the
  // ORM equivalent would change the generated SQL string and break strict
  // behavior preservation.
  await env.DB.prepare(
    `INSERT OR IGNORE INTO app_announcement_dismissal
       (announcementId, userId, dismissedAt) VALUES (?1, ?2, ?3)`,
  )
    .bind(id, user.id, Math.floor(Date.now() / 1000))
    .run();

  return jsonResponse({ ok: true });
}

export async function handleAckAnnouncement(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  id: string,
): Promise<Response> {
  // Acknowledge = mark as seen but don't permanently dismiss. Only
  // affects analytics for now; same code path as dismiss for popups but
  // does NOT insert a dismissal row. We keep the endpoint to make the
  // client integration cleaner (popup may "acknowledge" without
  // dismissing if the popup is non-dismissable).
  const authResult = await getAuthenticatedUserAllowPending(request, env);
  if (!isAuthed(authResult)) return authErrorResponse(authResult.error);
  const user = authResult;

  if (!SAFE_RESOURCE_ID_RE.test(id)) {
    return jsonResponse({ error: "Invalid announcement id" }, 400);
  }

  recordUsage(env, ctx, request, user, "announcement_ack", {
    metadata: { announcementId: id },
  });

  return jsonResponse({ ok: true });
}

function serializeAnnouncement(row: {
  id: string;
  kind: string;
  severity: string;
  title: string | null;
  body: string;
  ctaLabel: string | null;
  ctaUrl: string | null;
  audience: string;
  status: string;
  dismissable: number;
  startsAt: Date | null;
  expiresAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  const toIso = (d: Date | null | undefined) =>
    d ? (d instanceof Date ? d.toISOString() : new Date(d).toISOString()) : null;
  return {
    id: row.id,
    kind: row.kind,
    severity: row.severity,
    title: row.title,
    body: row.body,
    ctaLabel: row.ctaLabel,
    ctaUrl: row.ctaUrl,
    audience: row.audience,
    status: row.status,
    dismissable: Boolean(row.dismissable),
    startsAt: toIso(row.startsAt),
    expiresAt: toIso(row.expiresAt),
    createdAt: toIso(row.createdAt) ?? new Date().toISOString(),
    updatedAt: toIso(row.updatedAt) ?? new Date().toISOString(),
  };
}
