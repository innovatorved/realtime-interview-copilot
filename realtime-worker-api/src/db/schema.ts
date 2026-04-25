import { sqliteTable, text, integer, real, index, uniqueIndex } from "drizzle-orm/sqlite-core";

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
 * Per-user LLM generation parameter overrides. Any NULL column means
 * "inherit the global default from admin_config". Written only by admins
 * via /self-hosted-admin/user-model-params.
 */
export const userModelParams = sqliteTable("user_model_params", {
  userId: text("userId")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  maxOutputTokens: integer("maxOutputTokens"),
  temperature: real("temperature"),
  topP: real("topP"),
  thinkingBudget: text("thinkingBudget"),
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
/**
 * Generic per-user feature flag table. ONE table serves every flag forever:
 * adding a new flag is just registering a key in
 * `src/feature-flags/registry.ts` — no schema change, no new admin endpoint.
 *
 *  - `flagKey`   any string from the registry (validated before write).
 *  - `enabled`   primary on/off switch.
 *  - `valueJson` optional structured payload (variant, limits, JSON config)
 *                so we never need a second table for non-boolean flags.
 *
 * Rows are absent until an admin (or future system bootstrap) writes one;
 * the service layer merges registry defaults so callers always get a value.
 */
export const featureFlag = sqliteTable(
  "feature_flag",
  {
    id: text("id").primaryKey(),
    userId: text("userId")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    flagKey: text("flagKey").notNull(),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(false),
    valueJson: text("valueJson"),
    updatedAt: integer("updatedAt", { mode: "timestamp" }).notNull(),
    updatedByEmail: text("updatedByEmail"),
  },
  (table) => [
    uniqueIndex("feature_flag_user_key_idx").on(table.userId, table.flagKey),
    index("feature_flag_key_idx").on(table.flagKey),
  ],
);

/**
 * BYOK ("bring your own key") credentials for users whose `byok` feature
 * flag is enabled. Tokens are encrypted at rest with AES-GCM using the
 * worker secret `BYOK_ENC_KEY`; only `tokenLast4` is ever returned to
 * admins for display.
 *
 *  - `provider`         "deepgram" | "openai" (one row per provider per user).
 *  - `baseUrl`          user-supplied https:// (or wss:// for Deepgram) URL.
 *  - `tokenCiphertext`  base64 AES-GCM ciphertext of the user-provided token.
 *  - `tokenIv`          base64 12-byte IV used for the AES-GCM encryption.
 *  - `tokenLast4`       last 4 chars of the original token, for masked UI.
 *  - `modelName`        OpenAI-compatible model id (ignored for Deepgram).
 *  - `active`           user-side toggle; lets the user temporarily fall
 *                       back to the worker provider without deleting creds.
 *  - `disabledByAdmin`  admin kill switch, independent of `active`.
 */
export const byokCredential = sqliteTable(
  "byok_credential",
  {
    id: text("id").primaryKey(),
    userId: text("userId")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    baseUrl: text("baseUrl").notNull(),
    tokenCiphertext: text("tokenCiphertext").notNull(),
    tokenIv: text("tokenIv").notNull(),
    tokenLast4: text("tokenLast4").notNull(),
    modelName: text("modelName"),
    active: integer("active", { mode: "boolean" }).notNull().default(true),
    disabledByAdmin: integer("disabledByAdmin", { mode: "boolean" })
      .notNull()
      .default(false),
    createdAt: integer("createdAt", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updatedAt", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    uniqueIndex("byok_user_provider_idx").on(table.userId, table.provider),
  ],
);

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
