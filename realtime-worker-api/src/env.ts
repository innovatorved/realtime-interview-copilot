/**
 * Shared `Env` shape for every worker route + plugin.
 *
 * `extends PostHogEnv` is a pre-existing stale reference — the type is not
 * defined anywhere in the repo. Tracked as a known design flaw; preserved
 * verbatim here so the behavior-preserving split does not change types.
 */
export interface Env extends PostHogEnv {
  DEEPGRAM_API_KEY: string;
  GOOGLE_GENERATIVE_AI_API_KEY: string;
  GEMINI_MODEL?: string;
  BETTER_AUTH_SECRET: string;
  BETTER_AUTH_URL: string;
  /** Comma-separated emails allowed to use /api/admin/* (self-hosted dashboard). */
  ADMIN_EMAILS?: string;
  /** Cloudflare account id that owns the AI Gateway (fallback when not set via admin dashboard). */
  CF_ACCOUNT_ID?: string;
  /** Cloudflare AI Gateway id (fallback when not set via admin dashboard). */
  CF_GATEWAY_ID?: string;
  /** Cloudflare API token with AI Gateway read scope (fallback when not set via admin dashboard). */
  CF_API_TOKEN?: string;
  DB: D1Database;
  /** General-purpose KV namespace for the worker (see src/kv-keys.ts). */
  CONFIG_KV?: KVNamespace;
  /** Cloudflare built-in rate limiter for /api/completion. */
  COMPLETION_LIMITER?: {
    limit: (opts: { key: string }) => Promise<{ success: boolean }>;
  };
  /** When "true", quota checks block over-limit requests. */
  QUOTA_ENFORCEMENT?: string;
  /** When "false", disable dry-run quota consumption recording. Default ON. */
  QUOTA_RECORD_CONSUMPTION?: string;
}
