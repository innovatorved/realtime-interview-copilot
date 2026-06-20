/** Secondary IP-based rate limit via COMPLETION_LIMITER binding. */

import type { Env } from "../env";

export async function limitByIp(
  env: Env,
  prefix: string,
  ip: string | null,
): Promise<{ ok: true } | { ok: false; status: 429 | 503 }> {
  if (!ip || !env.COMPLETION_LIMITER) return { ok: true };
  try {
    const { success } = await env.COMPLETION_LIMITER.limit({
      key: `${prefix}:ip:${ip}`,
    });
    if (!success) return { ok: false, status: 429 };
    return { ok: true };
  } catch {
    return { ok: false, status: 503 };
  }
}
