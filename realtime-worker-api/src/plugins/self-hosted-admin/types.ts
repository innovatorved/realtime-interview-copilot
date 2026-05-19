/** Public types re-exported from the plugin entry point. */

import type { DrizzleD1Database } from "drizzle-orm/d1";
import type * as schemaTypes from "../../db/schema";

export type AuditEventType =
  | "user_signed_up"
  | "user_signed_in"
  | "user_signed_out"
  | "user_profile_updated"
  | "user_email_verified"
  | "user_banned"
  | "user_unbanned"
  | "user_deleted"
  | "user_approved"
  | "user_approval_revoked"
  | "session_created"
  | "session_revoked"
  | "sessions_revoked_all"
  | "password_changed"
  | "password_reset_requested"
  | "password_reset_completed"
  | "security_blocked"
  | "security_rate_limited"
  | "security_disposable_email"
  | "security_credential_stuffing"
  | "admin_action";

export type SecurityAction = "log" | "challenge" | "block";

export type SecurityEventType =
  | "credential_stuffing"
  | "rate_limit_exceeded"
  | "disposable_email"
  | "suspicious_ip"
  | "velocity_exceeded";

export interface SelfHostedAdminOptions {
  getDb: () => DrizzleD1Database<typeof schemaTypes>;
  d1: D1Database;
  adminEmails: string[];
  sentinel?: {
    maxLoginAttemptsPerHour?: number;
    maxSignupsPerHour?: number;
    blockDisposableEmails?: boolean;
  };
  runtimeInfo?: () => Record<string, unknown>;
  /** Invoked whenever admin_config is written/deleted so KV caches can flush. */
  onConfigChange?: () => Promise<void> | void;
}

export interface HealthCheckResult {
  ok: boolean;
  latencyMs: number;
  error?: string;
  lastProbe: string;
  source?: string;
  configured?: boolean;
  accountConfigured?: boolean;
  gatewayConfigured?: boolean;
}

export interface CfGatewayConfig {
  accountId: string;
  gatewayId: string;
  apiToken: string;
}

/** Internal helpers passed to every endpoint group. */
export interface AdminDeps {
  opts: SelfHostedAdminOptions;
  envAdmins: Set<string>;
  isAdmin: (email: string) => Promise<boolean>;
  invalidateAdminSetCache: () => void;
  recordAudit: (params: {
    eventType: AuditEventType;
    userId?: string | null;
    userEmail?: string | null;
    ipAddress?: string | null;
    userAgent?: string | null;
    metadata?: Record<string, unknown>;
  }) => Promise<void>;
  resolveCfConfig: () => Promise<CfGatewayConfig>;
  resolveActiveAiConfig: () => Promise<{
    geminiModel: string;
    geminiKey: string;
    geminiKeySource: string;
    deepgramKey: string;
    deepgramKeySource: string;
    customModelName: string;
    customBaseUrl: string;
    customApiKey: string;
    useCustom: boolean;
  }>;
  fetchAiGateway: (
    cfg: CfGatewayConfig,
    pathSuffix: string,
    query?: URLSearchParams,
  ) => Promise<{ ok: boolean; status: number; body: unknown }>;
  probeDeepgram: (apiKey: string) => Promise<HealthCheckResult>;
  probeGemini: (
    cf: CfGatewayConfig,
    modelName: string,
    apiKey: string,
  ) => Promise<HealthCheckResult>;
  probeCustomModel: (
    modelName: string,
    baseUrl: string,
    apiKey: string,
  ) => Promise<HealthCheckResult>;
  probeAiGateway: (cf: CfGatewayConfig) => Promise<HealthCheckResult>;
  getCachedHealth: (key: string) => HealthCheckResult | null;
}
