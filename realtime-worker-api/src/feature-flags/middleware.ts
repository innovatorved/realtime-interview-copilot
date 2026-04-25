/**
 * One-line gating helper used by every route that wants to be feature-flagged.
 *
 *   const gate = await requireFlag(env, userId, "byok");
 *   if (!gate.ok) return jsonResponse(gate.body, gate.status);
 *
 * Future flags use the same helper — no new code needed per flag.
 */

import { getDb } from "../db";
import { isEnabled } from "./service";
import type { FlagKey } from "./registry";

export type RequireFlagResult =
  | { ok: true }
  | { ok: false; status: number; body: { error: string; flag: string } };

export async function requireFlag(
  env: { DB: D1Database },
  userId: string,
  key: FlagKey,
): Promise<RequireFlagResult> {
  try {
    const db = getDb(env);
    const enabled = await isEnabled(db, userId, key);
    if (enabled) return { ok: true };
    return {
      ok: false,
      status: 403,
      body: { error: "feature_flag_disabled", flag: key },
    };
  } catch (e) {
    console.warn("[feature-flag] requireFlag failed:", e);
    return {
      ok: false,
      status: 503,
      body: { error: "feature_flag_check_failed", flag: key },
    };
  }
}
