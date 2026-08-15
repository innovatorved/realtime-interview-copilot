/** Zod schemas for admin GET endpoint query parameters. */

import { z } from "zod";
import {
  AI_GATEWAY_LOG_QUERY_KEYS,
  ANNOUNCEMENT_KIND,
  ANNOUNCEMENT_STATUS,
  IMPORTANT_EVENT_ACTIONS,
} from "./constants";
import { safeIdSchema } from "./schemas";

const paginationQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional(),
  offset: z.coerce.number().int().min(0).optional(),
  q: z.string().max(200).optional(),
});

export const usageWindowQuerySchema = z.enum(["1h", "24h", "7d", "30d", "90d"]).optional();

export const summaryWindowQuerySchema = z.enum(["1h", "24h", "7d", "30d"]).optional();

export const requiredUserIdQuerySchema = z.object({
  userId: safeIdSchema,
});

export const requiredIdQuerySchema = z.object({
  id: safeIdSchema,
});

export const listUsersQuerySchema = paginationQuerySchema.extend({
  filter: z.enum(["pending", "banned", "approved"]).optional(),
});

export const listNotesQuerySchema = paginationQuerySchema.extend({
  userId: safeIdSchema.optional(),
});

export const listSessionsQuerySchema = paginationQuerySchema;

export const auditLogsQuerySchema = paginationQuerySchema.extend({
  eventType: z.string().max(64).optional(),
  userId: safeIdSchema.optional(),
});

export const securityEventsQuerySchema = paginationQuerySchema.extend({
  eventType: z.string().max(64).optional(),
});

export const activityQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

export const usageSummaryQuerySchema = z.object({
  window: usageWindowQuerySchema,
});

export const usageByUserQuerySchema = paginationQuerySchema.extend({
  window: usageWindowQuerySchema,
});

export const usageUserDetailQuerySchema = z.object({
  userId: safeIdSchema,
  window: usageWindowQuerySchema,
});

export const usageEventsQuerySchema = paginationQuerySchema.extend({
  userId: safeIdSchema.optional(),
  action: z.string().regex(/^[a-z_]{1,40}$/).optional(),
  status: z.string().regex(/^[a-z_]{1,20}$/).optional(),
});

export const usageTimeseriesQuerySchema = z.object({
  window: usageWindowQuerySchema,
  userId: safeIdSchema.optional(),
});

export const supportThreadsQuerySchema = paginationQuerySchema.extend({
  status: z.enum(["open", "pending", "resolved"]).optional(),
  unreadOnly: z
    .enum(["true", "false"])
    .optional()
    .transform((v) => v === "true"),
  userId: safeIdSchema.optional(),
});

export const announcementsListQuerySchema = paginationQuerySchema.extend({
  status: z.enum(ANNOUNCEMENT_STATUS).optional(),
  kind: z.enum(ANNOUNCEMENT_KIND).optional(),
});

export const liveSessionsQuerySchema = paginationQuerySchema.extend({
  status: z.enum(["active", "stale", "ended"]).optional(),
  userId: safeIdSchema.optional(),
});

const parseableDateSchema = z
  .string()
  .refine((v) => Number.isFinite(Date.parse(v)), { message: "Invalid date" });

export const importantEventsQuerySchema = paginationQuerySchema.extend({
  userId: safeIdSchema.optional(),
  status: z.string().regex(/^[a-z_]{1,20}$/).optional(),
  sessionId: safeIdSchema.optional(),
  start: parseableDateSchema.optional(),
  end: parseableDateSchema.optional(),
  sort: z.enum(["asc", "desc"]).optional(),
  actions: z.string().max(2000).optional(),
});

/** Split comma-separated actions and keep only allow-listed values. */
export function resolveImportantEventActions(raw: string | undefined): string[] {
  const actionsRaw = (raw ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return actionsRaw.length > 0
    ? actionsRaw.filter((a) => (IMPORTANT_EVENT_ACTIONS as readonly string[]).includes(a))
    : [...IMPORTANT_EVENT_ACTIONS];
}

export const aiGatewayLogDetailQuerySchema = requiredIdQuerySchema;

export const aiGatewaySummaryQuerySchema = z.object({
  window: summaryWindowQuerySchema,
});

export const providersHealthQuerySchema = z.object({
  deep: z.enum(["0", "1", "true", "false"]).optional(),
});

const gatewayLogFieldSchemas = Object.fromEntries(
  AI_GATEWAY_LOG_QUERY_KEYS.map((key) => [key, z.string().max(200).optional()]),
) as Record<(typeof AI_GATEWAY_LOG_QUERY_KEYS)[number], z.ZodOptional<z.ZodString>>;

export const aiGatewayLogsQuerySchema = z.object({
  ...gatewayLogFieldSchemas,
  userId: safeIdSchema.optional(),
  userEmail: z.string().max(254).optional(),
});

export type AiGatewayLogsQuery = z.infer<typeof aiGatewayLogsQuerySchema>;

export const AI_GATEWAY_LOGS_QUERY_FIELDS = [
  ...AI_GATEWAY_LOG_QUERY_KEYS,
  "userId",
  "userEmail",
] as const;
