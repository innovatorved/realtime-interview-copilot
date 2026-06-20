/** /api/usage/me — user-facing usage breakdown (totals, per-action, timeseries). */

import {
  authErrorResponse,
  getAuthenticatedUser,
  isAuthed,
} from "../middleware/auth";
import { getDb } from "../db";
import { jsonResponse } from "../lib/http";
import { getUsageTimeseries, getUserUsageSummary } from "../usage";
import {
  ensureQuotaRow,
  getQuotaForUser,
  toQuotaSummary,
} from "../services/quota.service";
import type { Env } from "../env";

const USAGE_WINDOWS: Record<string, number> = {
  "24h": 86_400_000,
  "7d": 7 * 86_400_000,
  "30d": 30 * 86_400_000,
  "90d": 90 * 86_400_000,
};

export async function handleUsageMe(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  url: URL,
): Promise<Response> {
  const authResult = await getAuthenticatedUser(request, env, ctx);
  if (!isAuthed(authResult)) return authErrorResponse(authResult.error);

  const windowKey = (url.searchParams.get("window") ?? "30d").trim();
  const windowMs = USAGE_WINDOWS[windowKey];
  if (!windowMs) {
    return jsonResponse(
      { error: "window must be one of 24h, 7d, 30d, 90d" },
      400,
    );
  }

  const since = new Date(Date.now() - windowMs);
  const db = getDb(env);

  const summary = await getUserUsageSummary(db, authResult.id, since);

  await ensureQuotaRow(db, authResult.id);
  const quotaRow = await getQuotaForUser(db, authResult.id);
  const quota = toQuotaSummary(quotaRow, env);

  // Choose a sensible bucket width so the chart has ~30 points regardless
  // of window size.
  const bucketSeconds = Math.max(60, Math.floor(windowMs / 1000 / 30));
  const series = await getUsageTimeseries(
    env.DB,
    since,
    bucketSeconds,
    authResult.id,
  );

  return jsonResponse({
    window: windowKey,
    since: since.toISOString(),
    bucketSeconds,
    totals: summary.totals,
    perAction: summary.perAction,
    timeseries: series,
    quota,
  });
}
