/** Thin repository — note queries scoped to owner. */

import { and, count, desc, eq, like } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import { savedNote } from "../db/schema";

type Db = DrizzleD1Database<Record<string, never>>;

export async function listNotesForUser(
  db: Db,
  userId: string,
  opts: { limit: number; offset: number; search?: string; tag?: string },
) {
  const conditions = [eq(savedNote.userId, userId)];
  if (opts.search) conditions.push(like(savedNote.content, `%${opts.search}%`));
  if (opts.tag) conditions.push(eq(savedNote.tag, opts.tag));

  const whereClause = and(...conditions);
  const [rows, [{ total }]] = await Promise.all([
    db
      .select()
      .from(savedNote)
      .where(whereClause)
      .orderBy(desc(savedNote.createdAt))
      .limit(opts.limit)
      .offset(opts.offset),
    db.select({ total: count() }).from(savedNote).where(whereClause),
  ]);
  return { rows, total };
}

export async function deleteNoteForUser(db: Db, userId: string, noteId: string) {
  return db
    .delete(savedNote)
    .where(and(eq(savedNote.id, noteId), eq(savedNote.userId, userId)));
}
