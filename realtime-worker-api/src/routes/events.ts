/** /api/events/track — narrow client telemetry endpoint.
 *
 *  Allow-list driven so a compromised renderer cannot dump arbitrary
 *  rows into `usage_event`. Mirrors `IMPORTANT_EVENT_ACTIONS` in the
 *  admin plugin; the two have drifted historically and are tracked as a
 *  known design flaw. */

import {
  authErrorResponse,
  getAuthenticatedUser,
  isAuthed,
} from "../middleware/auth";
import { jsonResponse } from "../lib/http";
import { SAFE_SESSION_ID_RE } from "../lib/ids";
import { recordUsage } from "../usage";
import type { Env } from "../env";

const ALLOWED_TRACKED_ACTIONS = new Set<string>([
  "recording_start",
  "recording_stop",
  "screen_capture",
  "question_asked",
  "mode_switched",
  "completion_saved",
  "session_resumed",
  "session_paused_by_user",
]);

interface EventTrackBody {
  action?: unknown;
  sessionId?: unknown;
  metadata?: unknown;
}

export async function handleEventTrack(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  const authResult = await getAuthenticatedUser(request, env, ctx);
  if (!isAuthed(authResult)) return authErrorResponse(authResult.error);

  // Per-user limit so a noisy client can't fill usage_event.
  if (env.COMPLETION_LIMITER) {
    try {
      const { success } = await env.COMPLETION_LIMITER.limit({
        key: `event_track:${authResult.id}`,
      });
      if (!success)
        return jsonResponse({ error: "Tracking rate limit exceeded" }, 429);
    } catch (err) {
      console.warn("[Worker] event_track limiter threw, failing closed:", err);
      return jsonResponse({ error: "Rate limiter unavailable" }, 503);
    }
  }

  let body: EventTrackBody;
  try {
    body = (await request.json()) as EventTrackBody;
  } catch {
    return jsonResponse({ error: "Invalid JSON" }, 400);
  }
  if (body === null || typeof body !== "object") {
    return jsonResponse({ error: "Invalid body" }, 400);
  }

  const action = typeof body.action === "string" ? body.action : "";
  if (!ALLOWED_TRACKED_ACTIONS.has(action)) {
    return jsonResponse({ error: "action not allowed" }, 400);
  }
  const sessionId =
    typeof body.sessionId === "string" &&
    SAFE_SESSION_ID_RE.test(body.sessionId)
      ? body.sessionId
      : null;

  let metaJson: Record<string, unknown> = {};
  if (
    body.metadata &&
    typeof body.metadata === "object" &&
    !Array.isArray(body.metadata)
  ) {
    metaJson = body.metadata as Record<string, unknown>;
  }
  if (sessionId) metaJson.sessionId = sessionId;

  // Cap the metadata payload so a noisy client cannot blow up the row.
  const metaStr = JSON.stringify(metaJson);
  if (metaStr.length > 4000) {
    return jsonResponse({ error: "metadata too large" }, 413);
  }

  recordUsage(env, ctx, request, authResult, action, { metadata: metaJson });

  if (sessionId) {
    // Bump the session's eventCount + lastSeenAt so admins can spot
    // long-lived but quiet sessions.
    ctx.waitUntil(
      (async () => {
        try {
          await env.DB.prepare(
            `UPDATE live_session SET eventCount = eventCount + 1, lastSeenAt = ?1
               WHERE id = ?2 AND userId = ?3 AND endedAt IS NULL`,
          )
            .bind(Math.floor(Date.now() / 1000), sessionId, authResult.id)
            .run();
        } catch (e) {
          console.warn("[Worker] session event bump failed:", e);
        }
      })(),
    );
  }

  return jsonResponse({ ok: true });
}
