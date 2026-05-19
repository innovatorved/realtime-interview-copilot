/** /api/presets — built-in + per-user interview presets. */

import { eq, or } from "drizzle-orm";
import { getDb } from "../db";
import { interviewPreset } from "../db/schema";
import {
  authErrorResponse,
  getAuthenticatedUser,
  isAuthed,
} from "../middleware/auth";
import { jsonResponse } from "../lib/http";
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
    .select()
    .from(interviewPreset)
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
