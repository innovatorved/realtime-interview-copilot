/** Module-level constants and allow-lists for the admin plugin. */

import adminCfg from "../../config.json";

export const DISPOSABLE_DOMAINS = new Set(adminCfg.sentinel.disposableDomains);
export const RATE_LIMIT_WINDOW_MS = adminCfg.sentinel.rateLimits.windowMs;
export const ALLOWED_CONFIG_KEYS = adminCfg.allowedConfigKeys as readonly string[];

export const SAFE_ID_RE = /^[a-zA-Z0-9_-]{1,128}$/;
export const MAX_QUERY_LEN = 120;
export const MAX_LIMIT = 100;
export const DEFAULT_LIMIT = 50;

export const HEALTH_CACHE_TTL_MS = 30_000;

/** Upstream fetches performed on behalf of an admin should never hang a request. */
export const ADMIN_FETCH_TIMEOUT_MS = 10_000;

export const SECRET_KEY_SUFFIXES = [
  "_key",
  "_token",
  "_api_key",
  "_secret",
] as const;

export const THINKING_BUDGETS = ["off", "low", "medium", "high"] as const;

/** Allow-list prevents SSRF / header injection by forwarding only known keys. */
export const AI_GATEWAY_LOG_QUERY_KEYS = [
  "page",
  "per_page",
  "start_date",
  "end_date",
  "provider",
  "model",
  "model_type",
  "success",
  "cached",
  "search",
  "order_by",
  "order_by_direction",
  "direction",
  "min_duration",
  "max_duration",
  "min_cost",
  "max_cost",
  "min_tokens_in",
  "max_tokens_in",
  "min_tokens_out",
  "max_tokens_out",
  "min_total_tokens",
  "max_total_tokens",
  "feedback",
  "meta_info",
] as const;

export const SUMMARY_WINDOW_MS: Record<string, number> = {
  "1h": 3_600_000,
  "24h": 86_400_000,
  "7d": 7 * 86_400_000,
  "30d": 30 * 86_400_000,
};

export const USAGE_WINDOW_MS: Record<string, number> = {
  "1h": 3_600_000,
  "24h": 86_400_000,
  "7d": 7 * 86_400_000,
  "30d": 30 * 86_400_000,
  "90d": 90 * 86_400_000,
};

/**
 * Mirrors the server-side ALLOWED_TRACKED_ACTIONS in routes/events.ts plus
 * the LLM-level actions we already record automatically. Anything not on
 * this list is rejected so an attacker can't fish through the entire
 * usage_event table via an unsafe filter.
 *
 * KNOWN DESIGN FLAW: this list has drifted from `ALLOWED_TRACKED_ACTIONS`
 * (the client-allow list in routes/events.ts). Tracked for a separate
 * follow-up; intentionally preserved verbatim here.
 */
export const IMPORTANT_EVENT_ACTIONS = [
  "recording_start",
  "recording_stop",
  "screen_capture",
  "question_asked",
  "mode_switched",
  "completion_saved",
  "session_started",
  "session_ended",
  "session_resumed",
  "session_paused_by_user",
  "completion",
  "deepgram_key",
  "note_create",
  "note_delete",
  "export_markdown",
  "export_pdf",
] as const;

export const ANNOUNCEMENT_KIND = ["banner", "popup", "toast"] as const;
export const ANNOUNCEMENT_SEVERITY = [
  "info",
  "success",
  "warning",
  "error",
  "announcement",
] as const;
export const ANNOUNCEMENT_STATUS = ["active", "paused", "archived"] as const;
export const ANNOUNCEMENT_AUDIENCE = ["all", "users"] as const;
