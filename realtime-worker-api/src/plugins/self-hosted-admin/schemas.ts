/** Zod request schemas used by the admin endpoints. */

import { z } from "zod";
import {
  ALLOWED_CONFIG_KEYS,
  ANNOUNCEMENT_AUDIENCE,
  ANNOUNCEMENT_KIND,
  ANNOUNCEMENT_SEVERITY,
  ANNOUNCEMENT_STATUS,
  THINKING_BUDGETS,
} from "./constants";

const safeIdSchema = z.string().min(1).max(128).regex(/^[a-zA-Z0-9_-]+$/);

export const updateUserSchema = z.object({
  userId: safeIdSchema,
  isApproved: z.boolean().optional(),
  isBanned: z.boolean().optional(),
  banReason: z.string().max(500).optional(),
});

export const deleteUserSchema = z.object({ userId: safeIdSchema });

export const revokeSessionSchema = z.object({ sessionId: safeIdSchema });

export const revokeAllSessionsSchema = z.object({ userId: safeIdSchema });

const configKeyEnum = z.enum(ALLOWED_CONFIG_KEYS as [string, ...string[]]);

// 4000 chars covers real-world API keys (e.g. multi-segment JWTs, long
// signed tokens used by some self-hosted gateways) and lets us inline a
// moderate model name / URL without surprise 400s. 500 was too tight —
// users routinely hit it with longer custom-provider tokens and got a
// confusing schema-validation error instead of "saved".
export const updateConfigSchema = z.object({
  key: configKeyEnum,
  value: z.string().min(1).max(4000),
});

export const deleteConfigSchema = z.object({ key: configKeyEnum });

export const testModelSchema = z.object({
  modelName: z.string().min(1).max(200),
  baseUrl: z.string().url().max(500),
  apiKey: z.string().max(4000).optional(),
});

/** Body for the convenience POST /self-hosted-admin/openai-config endpoint.
 *  Writes the three `custom_*` admin_config rows in one shot so the admin
 *  dashboard doesn't have to make three sequential `update-config` calls
 *  (and so they can never get into a partial state where, say, model+url
 *  are set but the key is missing). Defaults intentionally target
 *  api.openai.com so a dashboard "Add OpenAI" button with just an API key
 *  works out of the box. */
export const openaiConfigSchema = z.object({
  apiKey: z.string().min(1).max(4000),
  baseUrl: z.string().url().max(500).optional(),
  model: z.string().min(1).max(200).optional(),
});

export const bulkUserIdsSchema = z.object({
  userIds: z.array(safeIdSchema).min(1).max(100),
});

export const bulkApproveSchema = z.object({
  userIds: z.array(safeIdSchema).min(1).max(100),
  approve: z.boolean(),
});

export const bulkBanSchema = z.object({
  userIds: z.array(safeIdSchema).min(1).max(100),
  ban: z.boolean(),
  banReason: z.string().max(500).optional(),
});

export const adminDeleteNoteSchema = z.object({ noteId: safeIdSchema });

export const revealConfigSchema = z.object({ key: configKeyEnum });

export const modelParamsBodySchema = z.object({
  maxOutputTokens: z.number().int().min(1).max(32768).optional(),
  temperature: z.number().min(0).max(2).optional(),
  topP: z.number().min(0).max(1).optional(),
  thinkingBudget: z.enum(THINKING_BUDGETS).optional(),
});

/** Per-user body: same 4 params, but each may be explicitly null to "clear"
 *  that override. userId is required. */
export const userModelParamsBodySchema = z.object({
  userId: safeIdSchema,
  maxOutputTokens: z.number().int().min(1).max(32768).nullable().optional(),
  temperature: z.number().min(0).max(2).nullable().optional(),
  topP: z.number().min(0).max(1).nullable().optional(),
  thinkingBudget: z.enum(THINKING_BUDGETS).nullable().optional(),
});

export const userModelParamsDeleteSchema = z.object({ userId: safeIdSchema });

export const QUOTA_PLAN_TIERS = [
  "legacy_unlimited",
  "free_tier",
  "early_access",
  "unlimited",
] as const;

export const quotaUpsertSchema = z.object({
  userId: safeIdSchema,
  planTier: z.enum(QUOTA_PLAN_TIERS).optional(),
  monthlyAllowanceSeconds: z.number().int().min(0).nullable().optional(),
  monthlyAllowanceCompletions: z.number().int().min(0).nullable().optional(),
  overageAllowed: z.boolean().optional(),
  consumedSeconds: z.number().int().min(0).optional(),
  consumedCompletions: z.number().int().min(0).optional(),
});

export type QuotaUpsert = z.infer<typeof quotaUpsertSchema>;

export const quotaResetCycleSchema = z.object({ userId: safeIdSchema });

export const quotaListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).optional(),
  q: z.string().max(200).optional(),
  tier: z.string().max(64).optional(),
});

export type QuotaListQuery = z.infer<typeof quotaListQuerySchema>;

export const liveSessionTerminateSchema = z.object({
  sessionId: safeIdSchema,
  reason: z.string().max(200).optional(),
  revokeAuthSessions: z.boolean().optional(),
});

export const supportReplySchema = z.object({
  threadId: safeIdSchema,
  body: z.string().min(1).max(8000),
  closeAfter: z.boolean().optional(),
});

export const supportUpdateStatusSchema = z.object({
  threadId: safeIdSchema,
  status: z.enum(["open", "pending", "resolved"]),
});

export const supportDeleteSchema = z.object({ threadId: safeIdSchema });

/** Enforce http/https on CTA URLs so an admin (or compromised admin
 *  account) cannot ship a `javascript:` or `data:` URL into every user's
 *  UI as a clickable button. Zod's `.url()` alone happily accepts
 *  `javascript:alert(1)`. */
const safeHttpUrlSchema = z
  .string()
  .url()
  .max(500)
  .refine(
    (v) => {
      try {
        const u = new URL(v);
        return u.protocol === "https:" || u.protocol === "http:";
      } catch {
        return false;
      }
    },
    { message: "ctaUrl must use http or https" },
  );

export const announcementCreateSchema = z
  .object({
    kind: z.enum(ANNOUNCEMENT_KIND).default("banner"),
    severity: z.enum(ANNOUNCEMENT_SEVERITY).default("info"),
    title: z.string().max(200).nullable().optional(),
    body: z.string().min(1).max(4000),
    ctaLabel: z.string().max(80).nullable().optional(),
    ctaUrl: safeHttpUrlSchema.nullable().optional(),
    audience: z.enum(ANNOUNCEMENT_AUDIENCE).default("all"),
    targetUserIds: z.array(safeIdSchema).max(5000).optional(),
    status: z.enum(ANNOUNCEMENT_STATUS).default("active"),
    dismissable: z.boolean().default(true),
    startsAt: z.string().datetime().nullable().optional(),
    expiresAt: z.string().datetime().nullable().optional(),
  })
  .refine(
    (v) =>
      v.audience !== "users" || (v.targetUserIds && v.targetUserIds.length > 0),
    { message: "audience='users' requires non-empty targetUserIds" },
  );

export const announcementUpdateSchema = z.object({
  id: safeIdSchema,
  kind: z.enum(ANNOUNCEMENT_KIND).optional(),
  severity: z.enum(ANNOUNCEMENT_SEVERITY).optional(),
  title: z.string().max(200).nullable().optional(),
  body: z.string().min(1).max(4000).optional(),
  ctaLabel: z.string().max(80).nullable().optional(),
  ctaUrl: safeHttpUrlSchema.nullable().optional(),
  audience: z.enum(ANNOUNCEMENT_AUDIENCE).optional(),
  targetUserIds: z.array(safeIdSchema).max(5000).optional(),
  status: z.enum(ANNOUNCEMENT_STATUS).optional(),
  dismissable: z.boolean().optional(),
  startsAt: z.string().datetime().nullable().optional(),
  expiresAt: z.string().datetime().nullable().optional(),
});

export const announcementIdSchema = z.object({ id: safeIdSchema });
