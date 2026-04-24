import { sqliteTable, text, integer, index, uniqueIndex } from "drizzle-orm/sqlite-core";

export const user = sqliteTable(
  "user",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    email: text("email").notNull().unique(),
    emailVerified: integer("emailVerified", { mode: "boolean" }).notNull(),
    isApproved: integer("isApproved", { mode: "boolean" }).default(false),
    isBanned: integer("isBanned", { mode: "boolean" }).default(false),
    banReason: text("banReason"),
    image: text("image"),
    lastActiveAt: integer("lastActiveAt", { mode: "timestamp" }),
    createdAt: integer("createdAt", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updatedAt", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    index("user_approved_idx").on(table.isApproved),
    index("user_banned_idx").on(table.isBanned),
    index("user_created_idx").on(table.createdAt),
    index("user_last_active_idx").on(table.lastActiveAt),
  ],
);

/** Matches production D1: columns `userId`, `body`, `createdAt` (legacy shape). */
export const savedNote = sqliteTable(
  "saved_note",
  {
    id: text("id").primaryKey(),
    userId: text("userId")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    content: text("body").notNull(),
    tag: text("tag").notNull().default("Copilot"),
    createdAt: integer("createdAt", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    index("saved_note_user_created_idx").on(table.userId, table.createdAt),
    index("saved_note_user_tag_idx").on(table.userId, table.tag),
  ],
);

export const interviewPreset = sqliteTable(
  "interview_preset",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    category: text("category").notNull(),
    context: text("context").notNull(),
    description: text("description"),
    icon: text("icon"),
    isBuiltIn: integer("isBuiltIn", { mode: "boolean" }).default(true),
    userId: text("userId").references(() => user.id, { onDelete: "cascade" }),
    createdAt: integer("createdAt", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    index("preset_user_idx").on(table.userId),
    index("preset_builtin_idx").on(table.isBuiltIn),
    index("preset_category_idx").on(table.category),
  ],
);

export const session = sqliteTable(
  "session",
  {
    id: text("id").primaryKey(),
    expiresAt: integer("expiresAt", { mode: "timestamp" }).notNull(),
    token: text("token").notNull().unique(),
    createdAt: integer("createdAt", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updatedAt", { mode: "timestamp" }).notNull(),
    ipAddress: text("ipAddress"),
    userAgent: text("userAgent"),
    userId: text("userId")
      .notNull()
      .references(() => user.id),
  },
  (table) => [
    index("session_user_idx").on(table.userId),
    index("session_expires_idx").on(table.expiresAt),
  ],
);

export const account = sqliteTable("account", {
  id: text("id").primaryKey(),
  accountId: text("accountId").notNull(),
  providerId: text("providerId").notNull(),
  userId: text("userId")
    .notNull()
    .references(() => user.id),
  accessToken: text("accessToken"),
  refreshToken: text("refreshToken"),
  idToken: text("idToken"),
  accessTokenExpiresAt: integer("accessTokenExpiresAt", { mode: "timestamp" }),
  refreshTokenExpiresAt: integer("refreshTokenExpiresAt", {
    mode: "timestamp",
  }),
  scope: text("scope"),
  password: text("password"),
  createdAt: integer("createdAt", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updatedAt", { mode: "timestamp" }).notNull(),
});

export const verification = sqliteTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: integer("expiresAt", { mode: "timestamp" }).notNull(),
  createdAt: integer("createdAt", { mode: "timestamp" }),
  updatedAt: integer("updatedAt", { mode: "timestamp" }),
});

export const auditEvent = sqliteTable(
  "audit_event",
  {
    id: text("id").primaryKey(),
    eventType: text("eventType").notNull(),
    userId: text("userId").references(() => user.id, { onDelete: "set null" }),
    userEmail: text("userEmail"),
    ipAddress: text("ipAddress"),
    userAgent: text("userAgent"),
    metadata: text("metadata"),
    createdAt: integer("createdAt", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    index("audit_event_type_idx").on(table.eventType),
    index("audit_event_user_idx").on(table.userId),
    index("audit_event_created_idx").on(table.createdAt),
  ],
);

export const securityEvent = sqliteTable(
  "security_event",
  {
    id: text("id").primaryKey(),
    eventType: text("eventType").notNull(),
    ipAddress: text("ipAddress"),
    userEmail: text("userEmail"),
    action: text("action").notNull(),
    metadata: text("metadata"),
    createdAt: integer("createdAt", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    index("security_event_type_idx").on(table.eventType),
    index("security_event_ip_idx").on(table.ipAddress),
    index("security_event_created_idx").on(table.createdAt),
  ],
);

export const rateLimitEntry = sqliteTable(
  "rate_limit",
  {
    id: text("id").primaryKey(),
    key: text("key").notNull(),
    count: integer("count").notNull().default(0),
    windowStart: integer("windowStart", { mode: "timestamp" }).notNull(),
    expiresAt: integer("expiresAt", { mode: "timestamp" }).notNull(),
  },
  (table) => [index("rate_limit_key_idx").on(table.key)],
);

export const adminConfig = sqliteTable("admin_config", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: integer("updatedAt", { mode: "timestamp" }).notNull(),
});

/**
 * Per-user, per-endpoint usage event. One row is inserted each time an
 * authenticated user performs a billable/tracked action (completion, deepgram
 * key mint, note create, etc). Used for both user-facing usage dashboards and
 * admin per-user usage breakdowns.
 *
 *  - action:       coarse bucket e.g. "completion", "deepgram_key",
 *                  "note_create", "note_delete", "preset_list",
 *                  "export_markdown", "export_pdf".
 *  - flag:         sub-classification for completions (copilot / summarizer / raw).
 *  - model:        underlying LLM model actually used (when known).
 *  - promptChars / responseChars: approximate input/output size (char count,
 *                  cheap to compute on the worker — we do NOT store prompt
 *                  bodies for privacy reasons).
 *  - durationMs:   wall-clock time the worker spent servicing the request.
 *  - status:       "ok" | "error" | "rate_limited".
 *  - errorCode:    short machine-readable error tag (e.g. HTTP status) when
 *                  status != "ok".
 *  - ipAddress / userAgent: useful for abuse detection; never indexed so
 *                  they can be dropped later if desired.
 *  - metadata:     JSON stringified bag for extra fields (e.g. imageUsed).
 */
export const usageEvent = sqliteTable(
  "usage_event",
  {
    id: text("id").primaryKey(),
    userId: text("userId").references(() => user.id, { onDelete: "cascade" }),
    userEmail: text("userEmail"),
    action: text("action").notNull(),
    flag: text("flag"),
    model: text("model"),
    promptChars: integer("promptChars").default(0),
    responseChars: integer("responseChars").default(0),
    durationMs: integer("durationMs").default(0),
    status: text("status").notNull().default("ok"),
    errorCode: text("errorCode"),
    ipAddress: text("ipAddress"),
    userAgent: text("userAgent"),
    metadata: text("metadata"),
    createdAt: integer("createdAt", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    index("usage_event_user_created_idx").on(table.userId, table.createdAt),
    index("usage_event_action_idx").on(table.action),
    index("usage_event_created_idx").on(table.createdAt),
    index("usage_event_status_idx").on(table.status),
  ],
);
