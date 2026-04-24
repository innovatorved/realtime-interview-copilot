/**
 * Central registry of keys stored in the shared CONFIG_KV namespace.
 *
 * CONFIG_KV is a general-purpose KV for the worker — it holds any
 * short-lived, non-authoritative data that benefits from low-latency reads
 * at the edge (cached admin_config, per-user activity timestamps, future
 * flags, cached tokens, etc.).
 *
 * Keep all key construction here so prefixes never collide and TTLs stay
 * consistent. Add new entries as new use cases appear.
 */

export const KV = {
  /** Hot-path cache of resolved admin_config (admin dashboard settings). */
  adminConfig: () => "admin_config:v1",

  /** 5-minute throttle for lastActiveAt updates per user. */
  userActivity: (userId: string) => `activity:${userId}`,
} as const;

export const KV_TTL_SECONDS = {
  /** admin_config changes rarely; 5 min is plenty and invalidated on write. */
  adminConfig: 300,
  /** Matches the lastActiveAt update cadence. */
  userActivity: 5 * 60,
} as const;
