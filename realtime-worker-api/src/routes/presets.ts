/** /api/presets — built-in + per-user interview presets with context overlay. */

import { and, eq, or, sql } from "drizzle-orm";
import { getDb } from "../db";
import { interviewPreset, presetUserContext } from "../db/schema";
import {
  authErrorResponse,
  getAuthenticatedUser,
  isAuthed,
} from "../middleware/auth";
import { jsonResponse } from "../lib/http";
import { presetContextPatchSchema } from "../schemas/preset-context";
import { recordUsage } from "../usage";
import type { Env } from "../env";

export async function handleGetPresets(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  const auth = await getAuthenticatedUser(request, env, ctx);
  if (!isAuthed(auth)) return authErrorResponse(auth.error);
  const user = auth;

  const db = getDb(env);
  const presets = await db
    .select({
      id: interviewPreset.id,
      name: interviewPreset.name,
      category: interviewPreset.category,
      context: interviewPreset.context,
      description: interviewPreset.description,
      icon: interviewPreset.icon,
      isBuiltIn: interviewPreset.isBuiltIn,
      userId: interviewPreset.userId,
      createdAt: interviewPreset.createdAt,
      resumeText: sql<string | null>`COALESCE(${presetUserContext.resumeText}, ${interviewPreset.resumeText})`,
      resumeFileName: sql<string | null>`COALESCE(${presetUserContext.resumeFileName}, ${interviewPreset.resumeFileName})`,
      jobDescription: sql<string | null>`COALESCE(${presetUserContext.jobDescription}, ${interviewPreset.jobDescription})`,
      updatedAt: sql<Date | null>`COALESCE(${presetUserContext.updatedAt}, ${interviewPreset.updatedAt})`,
    })
    .from(interviewPreset)
    .leftJoin(
      presetUserContext,
      and(
        eq(presetUserContext.presetId, interviewPreset.id),
        eq(presetUserContext.userId, user.id),
      ),
    )
    .where(
      or(
        eq(interviewPreset.isBuiltIn, true),
        eq(interviewPreset.userId, user.id),
      ),
    )
    .orderBy(interviewPreset.name);

  recordUsage(env, ctx, request, user, "preset_list", {
    metadata: { returned: presets.length },
  });

  return jsonResponse({ presets });
}

export async function handlePatchPresetContext(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  presetId: string,
): Promise<Response> {
  const auth = await getAuthenticatedUser(request, env, ctx);
  if (!isAuthed(auth)) return authErrorResponse(auth.error);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON" }, 400);
  }

  const parsed = presetContextPatchSchema.safeParse(body);
  if (!parsed.success) {
    return jsonResponse({ error: parsed.error.message }, 400);
  }

  const db = getDb(env);
  const [preset] = await db
    .select({
      id: interviewPreset.id,
      isBuiltIn: interviewPreset.isBuiltIn,
      userId: interviewPreset.userId,
    })
    .from(interviewPreset)
    .where(eq(interviewPreset.id, presetId));

  if (!preset) return jsonResponse({ error: "Preset not found" }, 404);

  const now = new Date();
  const fields = {
    resumeText:
      parsed.data.resumeText !== undefined ? parsed.data.resumeText : undefined,
    resumeFileName:
      parsed.data.resumeFileName !== undefined
        ? parsed.data.resumeFileName
        : undefined,
    jobDescription:
      parsed.data.jobDescription !== undefined
        ? parsed.data.jobDescription
        : undefined,
    updatedAt: now,
  };

  if (preset.isBuiltIn) {
    const overlay = {
      userId: auth.id,
      presetId,
      resumeText: fields.resumeText ?? null,
      resumeFileName: fields.resumeFileName ?? null,
      jobDescription: fields.jobDescription ?? null,
      updatedAt: now,
    };

    const [existing] = await db
      .select()
      .from(presetUserContext)
      .where(
        and(
          eq(presetUserContext.userId, auth.id),
          eq(presetUserContext.presetId, presetId),
        ),
      );

    if (existing) {
      await db
        .update(presetUserContext)
        .set({
          resumeText:
            fields.resumeText !== undefined ? fields.resumeText : existing.resumeText,
          resumeFileName:
            fields.resumeFileName !== undefined
              ? fields.resumeFileName
              : existing.resumeFileName,
          jobDescription:
            fields.jobDescription !== undefined
              ? fields.jobDescription
              : existing.jobDescription,
          updatedAt: now,
        })
        .where(
          and(
            eq(presetUserContext.userId, auth.id),
            eq(presetUserContext.presetId, presetId),
          ),
        );
    } else {
      await db.insert(presetUserContext).values(overlay);
    }
  } else {
    if (preset.userId !== auth.id) {
      return jsonResponse({ error: "Forbidden" }, 403);
    }
    const updates: Record<string, unknown> = { updatedAt: now };
    if (fields.resumeText !== undefined) updates.resumeText = fields.resumeText;
    if (fields.resumeFileName !== undefined)
      updates.resumeFileName = fields.resumeFileName;
    if (fields.jobDescription !== undefined)
      updates.jobDescription = fields.jobDescription;

    await db
      .update(interviewPreset)
      .set(updates)
      .where(
        and(eq(interviewPreset.id, presetId), eq(interviewPreset.userId, auth.id)),
      );
  }

  recordUsage(env, ctx, request, auth, "preset_context_update", {
    metadata: { presetId, isBuiltIn: preset.isBuiltIn },
  });

  return jsonResponse({ ok: true });
}
