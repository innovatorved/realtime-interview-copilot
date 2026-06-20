/** /api/support/messages — user↔admin messaging.
 *
 *  All three handlers accept *pending* users — a user waiting for admin
 *  approval can still write to the admin to explain their request. Banned
 *  users are still rejected by `getAuthenticatedUserAllowPending`. */

import { and, asc, count, desc, eq, isNull, or } from "drizzle-orm";
import { getDb } from "../db";
import { supportMessage } from "../db/schema";
import {
  authErrorResponse,
  getAuthenticatedUserAllowPending,
  isAuthed,
} from "../middleware/auth";
import { getClientIp } from "../lib/ip";
import { limitByIp } from "../lib/ip-rate-limit";
import { jsonResponse } from "../lib/http";
import { SAFE_RESOURCE_ID_RE } from "../lib/ids";
import { recordUsage } from "../usage";
import type { Env } from "../env";

const MAX_SUPPORT_BODY_CHARS = 4_000;
const MAX_SUPPORT_SUBJECT_CHARS = 200;
const MAX_SUPPORT_THREADS_PER_USER = 100;
const MAX_REPLIES_PER_THREAD = 200;

interface CreateSupportMessageBody {
  subject?: unknown;
  body?: unknown;
  parentId?: unknown;
}

export async function handleCreateSupportMessage(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  const authResult = await getAuthenticatedUserAllowPending(request, env);
  if (!isAuthed(authResult)) return authErrorResponse(authResult.error);
  const user = authResult;

  // Per-user rate limit so a malicious script can't fill the inbox.
  if (env.COMPLETION_LIMITER) {
    const ip = getClientIp(request);
    const ipLimit = await limitByIp(env, "support_create", ip);
    if (!ipLimit.ok) {
      return jsonResponse(
        { error: ipLimit.status === 429 ? "Too many messages. Please wait a moment." : "Rate limiter unavailable" },
        ipLimit.status,
      );
    }
    try {
      const { success } = await env.COMPLETION_LIMITER.limit({
        key: `support_create:${user.id}`,
      });
      if (!success) {
        return jsonResponse(
          { error: "Too many messages. Please wait a moment." },
          429,
        );
      }
    } catch (err) {
      console.warn("[Worker] support_create limiter threw:", err);
      return jsonResponse({ error: "Rate limiter unavailable" }, 503);
    }
  }

  let body: CreateSupportMessageBody;
  try {
    body = (await request.json()) as CreateSupportMessageBody;
  } catch {
    return jsonResponse({ error: "Invalid JSON" }, 400);
  }
  if (body === null || typeof body !== "object") {
    return jsonResponse({ error: "Invalid body" }, 400);
  }

  const rawBody = typeof body.body === "string" ? body.body : "";
  const messageBody = rawBody.trim();
  if (!messageBody) {
    return jsonResponse({ error: "body is required" }, 400);
  }
  if (messageBody.length > MAX_SUPPORT_BODY_CHARS) {
    return jsonResponse(
      { error: `body exceeds ${MAX_SUPPORT_BODY_CHARS} characters` },
      413,
    );
  }

  let subject: string | null = null;
  if (body.subject !== undefined) {
    if (typeof body.subject !== "string") {
      return jsonResponse({ error: "subject must be a string" }, 400);
    }
    const trimmed = body.subject.trim().slice(0, MAX_SUPPORT_SUBJECT_CHARS);
    subject = trimmed.length > 0 ? trimmed : null;
  }

  let parentId: string | null = null;
  if (body.parentId !== undefined && body.parentId !== null) {
    if (
      typeof body.parentId !== "string" ||
      !SAFE_RESOURCE_ID_RE.test(body.parentId)
    ) {
      return jsonResponse({ error: "Invalid parentId" }, 400);
    }
    parentId = body.parentId;
  }

  const db = getDb(env);

  if (parentId) {
    // Verify the user owns the parent thread before adding a reply.
    const [parent] = await db
      .select({
        id: supportMessage.id,
        userId: supportMessage.userId,
        parentId: supportMessage.parentId,
      })
      .from(supportMessage)
      .where(eq(supportMessage.id, parentId))
      .limit(1);
    if (!parent) {
      return jsonResponse({ error: "Parent thread not found" }, 404);
    }
    if (parent.parentId !== null) {
      return jsonResponse(
        { error: "parentId must point at a thread root" },
        400,
      );
    }
    if (parent.userId !== user.id) {
      return jsonResponse({ error: "Forbidden" }, 403);
    }

    const [{ replies }] = await db
      .select({ replies: count() })
      .from(supportMessage)
      .where(eq(supportMessage.parentId, parentId));
    if (replies >= MAX_REPLIES_PER_THREAD) {
      return jsonResponse(
        {
          error: `Thread is full (max ${MAX_REPLIES_PER_THREAD} replies).`,
        },
        409,
      );
    }
  } else {
    // New thread — cap how many threads any one user can open.
    const [{ threads }] = await db
      .select({ threads: count() })
      .from(supportMessage)
      .where(
        and(
          eq(supportMessage.userId, user.id),
          isNull(supportMessage.parentId),
        ),
      );
    if (threads >= MAX_SUPPORT_THREADS_PER_USER) {
      return jsonResponse(
        {
          error: `You have reached the maximum of ${MAX_SUPPORT_THREADS_PER_USER} threads.`,
        },
        409,
      );
    }
  }

  const id = crypto.randomUUID();
  const now = new Date();

  await db.insert(supportMessage).values({
    id,
    userId: user.id,
    userEmail: user.email,
    userName: user.name,
    parentId,
    authorType: "user",
    authorEmail: user.email,
    subject,
    body: messageBody,
    // Reply rows live at status 'reply' so admin filters can hide them
    // when paginating the thread-roots list. Root rows go to 'open'.
    status: parentId ? "reply" : "open",
    unreadByAdmin: 1,
    unreadByUser: 0,
    ipAddress: getClientIp(request),
    userAgent: request.headers.get("user-agent")?.slice(0, 500) ?? null,
    createdAt: now,
    updatedAt: now,
  });

  // If this was a reply, bump the parent thread's unread/updated state
  // and reopen it ("user followed up after admin reply").
  if (parentId) {
    await db
      .update(supportMessage)
      .set({
        status: "open",
        unreadByAdmin: 1,
        updatedAt: now,
      })
      .where(eq(supportMessage.id, parentId));
  }

  recordUsage(env, ctx, request, user, "support_message_create", {
    promptChars: messageBody.length,
    metadata: { messageId: id, parentId, hasSubject: Boolean(subject) },
  });

  return jsonResponse(
    {
      message: {
        id,
        parentId,
        subject,
        body: messageBody,
        authorType: "user",
        status: parentId ? "reply" : "open",
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
      },
    },
    201,
  );
}

export async function handleListSupportMessages(
  request: Request,
  env: Env,
): Promise<Response> {
  const authResult = await getAuthenticatedUserAllowPending(request, env);
  if (!isAuthed(authResult)) return authErrorResponse(authResult.error);
  const user = authResult;

  const url = new URL(request.url);
  const limit = Math.min(
    100,
    Math.max(1, parseInt(url.searchParams.get("limit") ?? "50", 10) || 50),
  );
  const offset = Math.max(
    0,
    parseInt(url.searchParams.get("offset") ?? "0", 10) || 0,
  );
  const threadIdRaw = url.searchParams.get("threadId");

  const db = getDb(env);

  if (threadIdRaw) {
    if (!SAFE_RESOURCE_ID_RE.test(threadIdRaw)) {
      return jsonResponse({ error: "Invalid threadId" }, 400);
    }

    const [root] = await db
      .select()
      .from(supportMessage)
      .where(eq(supportMessage.id, threadIdRaw))
      .limit(1);
    if (!root) return jsonResponse({ error: "Thread not found" }, 404);
    if (root.userId !== user.id) {
      return jsonResponse({ error: "Forbidden" }, 403);
    }
    if (root.parentId !== null) {
      return jsonResponse(
        { error: "threadId must point at a thread root" },
        400,
      );
    }

    const messages = await db
      .select()
      .from(supportMessage)
      .where(
        or(
          eq(supportMessage.id, threadIdRaw),
          eq(supportMessage.parentId, threadIdRaw),
        )!,
      )
      .orderBy(asc(supportMessage.createdAt));

    return jsonResponse({
      thread: serializeSupportMessage(root),
      messages: messages.map(serializeSupportMessage),
    });
  }

  // List all thread roots owned by this user.
  const where = and(
    eq(supportMessage.userId, user.id),
    isNull(supportMessage.parentId),
  );

  const [rows, [{ total }]] = await Promise.all([
    db
      .select()
      .from(supportMessage)
      .where(where)
      .orderBy(desc(supportMessage.updatedAt))
      .limit(limit)
      .offset(offset),
    db.select({ total: count() }).from(supportMessage).where(where),
  ]);

  return jsonResponse({
    threads: rows.map(serializeSupportMessage),
    total,
    pagination: { limit, offset },
  });
}

export async function handleMarkSupportThreadReadByUser(
  request: Request,
  env: Env,
): Promise<Response> {
  const authResult = await getAuthenticatedUserAllowPending(request, env);
  if (!isAuthed(authResult)) return authErrorResponse(authResult.error);
  const user = authResult;

  let body: { threadId?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return jsonResponse({ error: "Invalid JSON" }, 400);
  }
  const threadId = typeof body?.threadId === "string" ? body.threadId : "";
  if (!SAFE_RESOURCE_ID_RE.test(threadId)) {
    return jsonResponse({ error: "Invalid threadId" }, 400);
  }

  const db = getDb(env);
  const [root] = await db
    .select({ id: supportMessage.id, userId: supportMessage.userId })
    .from(supportMessage)
    .where(
      and(eq(supportMessage.id, threadId), isNull(supportMessage.parentId)),
    )
    .limit(1);
  if (!root) return jsonResponse({ error: "Thread not found" }, 404);
  if (root.userId !== user.id) {
    return jsonResponse({ error: "Forbidden" }, 403);
  }

  await db
    .update(supportMessage)
    .set({ unreadByUser: 0, updatedAt: new Date() })
    .where(eq(supportMessage.id, threadId));

  return jsonResponse({ ok: true });
}

function serializeSupportMessage(row: {
  id: string;
  userId: string | null;
  userEmail: string | null;
  userName: string | null;
  parentId: string | null;
  authorType: string;
  authorEmail: string | null;
  subject: string | null;
  body: string;
  status: string;
  unreadByAdmin: number;
  unreadByUser: number;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: row.id,
    userId: row.userId,
    userEmail: row.userEmail,
    userName: row.userName,
    parentId: row.parentId,
    authorType: row.authorType,
    authorEmail: row.authorEmail,
    subject: row.subject,
    body: row.body,
    status: row.status,
    unreadByAdmin: Boolean(row.unreadByAdmin),
    unreadByUser: Boolean(row.unreadByUser),
    createdAt:
      row.createdAt instanceof Date
        ? row.createdAt.toISOString()
        : new Date(row.createdAt).toISOString(),
    updatedAt:
      row.updatedAt instanceof Date
        ? row.updatedAt.toISOString()
        : new Date(row.updatedAt).toISOString(),
  };
}
