/** /api/interview-context — per-user resume, JD, and interview notes. */

import { eq } from "drizzle-orm";
import { getDb } from "../db";
import { userInterviewContext } from "../db/schema";
import {
  authErrorResponse,
  getAuthenticatedUser,
  isAuthed,
} from "../middleware/auth";
import { jsonResponse } from "../lib/http";
import { interviewContextPatchSchema } from "../schemas/interview-context";
import { recordUsage } from "../usage";
import type { Env } from "../env";

const EMPTY_CONTEXT = {
  interviewNotes: null as string | null,
  resumeText: null as string | null,
  resumeFileName: null as string | null,
  jobDescription: null as string | null,
  updatedAt: null as Date | null,
};

export async function handleGetInterviewContext(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  const auth = await getAuthenticatedUser(request, env, ctx);
  if (!isAuthed(auth)) return authErrorResponse(auth.error);

  const db = getDb(env);
  const [row] = await db
    .select()
    .from(userInterviewContext)
    .where(eq(userInterviewContext.userId, auth.id));

  recordUsage(env, ctx, request, auth, "interview_context_fetch", {
    metadata: { hasRow: !!row },
  });

  return jsonResponse({
    context: row
      ? {
          interviewNotes: row.interviewNotes,
          resumeText: row.resumeText,
          resumeFileName: row.resumeFileName,
          jobDescription: row.jobDescription,
          updatedAt: row.updatedAt,
        }
      : EMPTY_CONTEXT,
  });
}

export async function handlePatchInterviewContext(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  const auth = await getAuthenticatedUser(request, env, ctx);
  if (!isAuthed(auth)) return authErrorResponse(auth.error);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON" }, 400);
  }

  const parsed = interviewContextPatchSchema.safeParse(body);
  if (!parsed.success) {
    return jsonResponse({ error: parsed.error.message }, 400);
  }

  const db = getDb(env);
  const now = new Date();
  const [existing] = await db
    .select()
    .from(userInterviewContext)
    .where(eq(userInterviewContext.userId, auth.id));

  const fields = parsed.data;
  const next = {
    interviewNotes:
      fields.interviewNotes !== undefined
        ? fields.interviewNotes
        : (existing?.interviewNotes ?? null),
    resumeText:
      fields.resumeText !== undefined
        ? fields.resumeText
        : (existing?.resumeText ?? null),
    resumeFileName:
      fields.resumeFileName !== undefined
        ? fields.resumeFileName
        : (existing?.resumeFileName ?? null),
    jobDescription:
      fields.jobDescription !== undefined
        ? fields.jobDescription
        : (existing?.jobDescription ?? null),
    updatedAt: now,
  };

  if (existing) {
    await db
      .update(userInterviewContext)
      .set(next)
      .where(eq(userInterviewContext.userId, auth.id));
  } else {
    await db.insert(userInterviewContext).values({
      userId: auth.id,
      ...next,
    });
  }

  recordUsage(env, ctx, request, auth, "interview_context_update", {
    metadata: {
      hasResume: !!next.resumeText?.trim(),
      hasJd: !!next.jobDescription?.trim(),
    },
  });

  return jsonResponse({ ok: true, context: next });
}
