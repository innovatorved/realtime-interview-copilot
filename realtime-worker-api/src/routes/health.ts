/** GET /api/health — lightweight liveness for status pages. */

import { jsonResponse } from "../lib/http";
import { getCachedHealth } from "../plugins/self-hosted-admin/internal/health-cache";
import type { Env } from "../env";

export async function handleHealth(request: Request, env: Env): Promise<Response> {
  const started = Date.now();
  let dbOk = false;
  try {
    await env.DB.prepare("SELECT 1").first();
    dbOk = true;
  } catch {
    dbOk = false;
  }

  const geminiProbe = getCachedHealth("gemini");
  const deepgramProbe = getCachedHealth("deepgram");

  const status =
    dbOk && geminiProbe?.ok !== false && deepgramProbe?.ok !== false
      ? "healthy"
      : "degraded";

  return jsonResponse({
    status,
    timestamp: new Date().toISOString(),
    latencyMs: Date.now() - started,
    checks: {
      database: { ok: dbOk },
      geminiKey: geminiProbe ?? { ok: null, note: "not_probed" },
      deepgramKey: deepgramProbe ?? { ok: null, note: "not_probed" },
    },
  });
}
