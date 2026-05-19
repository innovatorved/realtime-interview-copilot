/** /api/notes — list, create, delete. Notes are private to the user. */

import { and, count, desc, eq, like } from "drizzle-orm";
import { getDb } from "../db";
import { savedNote } from "../db/schema";
import {
  authErrorResponse,
  getAuthenticatedUser,
  isAuthed,
} from "../middleware/auth";
import { jsonResponse } from "../lib/http";
import { recordUsage } from "../usage";
import type { Env } from "../env";

const MAX_NOTE_CONTENT_CHARS = 50_000;
const MAX_NOTE_TAG_CHARS = 100;

export async function handleGetNotes(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  url: URL,
): Promise<Response> {
  const auth = await getAuthenticatedUser(request, env, ctx);
  if (!isAuthed(auth)) return authErrorResponse(auth.error);
  const user = auth;

  const db = getDb(env);
  const page = Math.max(1, parseInt(url.searchParams.get("page") ?? "1", 10));
  const limit = Math.min(
    50,
    Math.max(1, parseInt(url.searchParams.get("limit") ?? "20", 10)),
  );
  const search = (url.searchParams.get("q") ?? "").trim();
  const tag = (url.searchParams.get("tag") ?? "").trim();
  const offset = (page - 1) * limit;

  const conditions = [eq(savedNote.userId, user.id)];
  if (search) {
    conditions.push(like(savedNote.content, `%${search}%`));
  }
  if (tag) {
    conditions.push(eq(savedNote.tag, tag));
  }

  const whereClause =
    conditions.length === 1 ? conditions[0] : and(...conditions);

  const [notes, totalResult] = await Promise.all([
    db
      .select()
      .from(savedNote)
      .where(whereClause)
      .orderBy(desc(savedNote.createdAt))
      .limit(limit)
      .offset(offset),
    db.select({ total: count() }).from(savedNote).where(whereClause),
  ]);

  const total = totalResult[0]?.total ?? 0;

  recordUsage(env, ctx, request, user, "note_list", {
    metadata: { returned: notes.length, page, limit },
  });

  return jsonResponse({
    notes,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  });
}

export async function handleCreateNote(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  const auth = await getAuthenticatedUser(request, env, ctx);
  if (!isAuthed(auth)) return authErrorResponse(auth.error);
  const user = auth;

  let body: { content?: unknown; tag?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return jsonResponse({ error: "Invalid JSON" }, 400);
  }

  if (body === null || typeof body !== "object") {
    return jsonResponse({ error: "Invalid body" }, 400);
  }

  const rawContent = typeof body.content === "string" ? body.content : "";
  const content = rawContent.trim();
  if (!content) return jsonResponse({ error: "content is required" }, 400);
  if (content.length > MAX_NOTE_CONTENT_CHARS) {
    return jsonResponse(
      { error: `content exceeds ${MAX_NOTE_CONTENT_CHARS} characters` },
      413,
    );
  }

  let tag = "Copilot";
  if (body.tag !== undefined) {
    if (typeof body.tag !== "string") {
      return jsonResponse({ error: "tag must be a string" }, 400);
    }
    const trimmed = body.tag.trim();
    if (trimmed.length === 0 || trimmed.length > MAX_NOTE_TAG_CHARS) {
      return jsonResponse(
        { error: `tag must be 1..${MAX_NOTE_TAG_CHARS} characters` },
        400,
      );
    }
    tag = trimmed;
  }

  const db = getDb(env);
  const id = crypto.randomUUID();
  const now = new Date();

  const note = {
    id,
    userId: user.id,
    content,
    tag,
    createdAt: now,
  };

  await db.insert(savedNote).values(note);

  recordUsage(env, ctx, request, user, "note_create", {
    promptChars: content.length,
    metadata: { tag, noteId: id },
  });

  return jsonResponse({ note }, 201);
}

export async function handleDeleteNote(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  noteId: string,
): Promise<Response> {
  const auth = await getAuthenticatedUser(request, env, ctx);
  if (!isAuthed(auth)) return authErrorResponse(auth.error);
  const user = auth;

  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(noteId)) {
    return jsonResponse({ error: "Invalid note id" }, 400);
  }

  const db = getDb(env);
  await db
    .delete(savedNote)
    .where(and(eq(savedNote.id, noteId), eq(savedNote.userId, user.id)));

  recordUsage(env, ctx, request, user, "note_delete", {
    metadata: { noteId },
  });

  return jsonResponse({ success: true });
}
