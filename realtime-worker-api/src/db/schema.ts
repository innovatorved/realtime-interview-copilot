import {
  sqliteTable,
  text,
  integer,
  real,
  index,
  primaryKey,
} from "drizzle-orm/sqlite-core";

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
    workspaceId: text("workspaceId"),
    createdAt: integer("createdAt", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    index("saved_note_user_created_idx").on(table.userId, table.createdAt),
    index("saved_note_user_tag_idx").on(table.userId, table.tag),
  ],
);

/** Per-user interview prep: notes, resume text, and job description. */
export const userInterviewContext = sqliteTable("user_interview_context", {
  userId: text("userId")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  interviewNotes: text("interviewNotes"),
  resumeText: text("resumeText"),
  resumeFileName: text("resumeFileName"),
  jobDescription: text("jobDescription"),
  updatedAt: integer("updatedAt", { mode: "timestamp" }).notNull(),
});

export const quotaBalance = sqliteTable("quota_balance", {
  userId: text("userId")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  planTier: text("planTier").notNull().default("legacy_unlimited"),
  monthlyAllowanceSeconds: integer("monthlyAllowanceSeconds"),
  monthlyAllowanceCompletions: integer("monthlyAllowanceCompletions"),
  consumedSeconds: integer("consumedSeconds").notNull().default(0),
  consumedCompletions: integer("consumedCompletions").notNull().default(0),
  cycleResetAt: integer("cycleResetAt", { mode: "timestamp" }).notNull(),
  overageAllowed: integer("overageAllowed", { mode: "boolean" }).notNull().default(true),
  createdAt: integer("createdAt", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updatedAt", { mode: "timestamp" }).notNull(),
});

export const workspace = sqliteTable("workspace", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  ownerUserId: text("ownerUserId")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  createdAt: integer("createdAt", { mode: "timestamp" }).notNull(),
});

export const workspaceMember = sqliteTable(
  "workspace_member",
  {
    workspaceId: text("workspaceId")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    userId: text("userId")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    role: text("role").notNull().default("member"),
    joinedAt: integer("joinedAt", { mode: "timestamp" }).notNull(),
  },
  (table) => [primaryKey({ columns: [table.workspaceId, table.userId] })],
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
 *                  "note_create", "note_delete", "interview_context_fetch",
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
    workspaceId: text("workspaceId"),
    createdAt: integer("createdAt", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    index("usage_event_user_created_idx").on(table.userId, table.createdAt),
    index("usage_event_action_idx").on(table.action),
    index("usage_event_created_idx").on(table.createdAt),
    index("usage_event_status_idx").on(table.status),
  ],
);

/**
 * Live interview session. One row per "Start Listening" press from the
 * recorder. Marked `endedAt` when the recorder stops, the user navigates
 * away, or an admin terminates it. Admin termination works by deleting
 * the upstream Deepgram key (`deepgramKeyId`) so the candidate's
 * WebSocket disconnects on the next audio chunk — no client-side polling.
 *
 *  - lastSeenAt: refreshed when the recorder mints a Deepgram key or
 *    posts a tracked event. Sessions with `endedAt IS NULL AND
 *    lastSeenAt < now-5min` are surfaced as "stale" in the admin
 *    dashboard (likely client crash).
 *  - deepgramKeyId / deepgramProjectId: the Deepgram-side handles for
 *    the most recent minted key. The admin terminate endpoint calls
 *    DELETE /v1/projects/{projectId}/keys/{keyId} to revoke it.
 */
/**
 * Support messages: lets users (especially those waiting for approval)
 * write to admins, and admins reply back. Threaded via `parentId` — a
 * thread root has parentId = NULL, replies point at the root id.
 *
 *  - authorType: 'user' for end-user messages, 'admin' for admin replies.
 *  - status: only meaningful on the thread root.
 *      'open'      → awaiting admin response
 *      'pending'   → admin has replied, waiting on user
 *      'resolved'  → admin marked the conversation done
 *      'reply'     → applied to admin reply rows so dashboard filters
 *                    can hide them when listing thread roots
 *  - unreadByAdmin / unreadByUser: drive the small unread badges on
 *    both sides. Cleared by reading endpoints, set by the appropriate
 *    create endpoints.
 */
export const supportMessage = sqliteTable(
  "support_message",
  {
    id: text("id").primaryKey(),
    userId: text("userId").references(() => user.id, { onDelete: "cascade" }),
    userEmail: text("userEmail"),
    userName: text("userName"),
    parentId: text("parentId"),
    authorType: text("authorType").notNull(),
    authorEmail: text("authorEmail"),
    subject: text("subject"),
    body: text("body").notNull(),
    status: text("status").notNull().default("open"),
    unreadByAdmin: integer("unreadByAdmin").notNull().default(1),
    unreadByUser: integer("unreadByUser").notNull().default(0),
    ipAddress: text("ipAddress"),
    userAgent: text("userAgent"),
    metadata: text("metadata"),
    createdAt: integer("createdAt", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updatedAt", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    index("support_message_user_idx").on(table.userId),
    index("support_message_parent_idx").on(table.parentId),
    index("support_message_status_idx").on(table.status),
    index("support_message_unread_idx").on(table.unreadByAdmin),
    index("support_message_created_idx").on(table.createdAt),
  ],
);

/**
 * App announcements: admin-controlled banners and popups shown inside
 * the desktop app. Targeted to either everyone (`audience='all'`) or a
 * fixed list of user ids stored as JSON in `targetUserIds`.
 *
 *  - kind: 'banner' (top strip), 'popup' (modal), 'toast' (ephemeral).
 *  - severity: 'info' | 'success' | 'warning' | 'error' | 'announcement'.
 *  - status: only `'active'` rows are returned to the client. Admin can
 *    flip to 'paused' to hide without deleting and 'archived' to retire.
 *  - dismissable: when 0 the popup/banner has no close button. Use this
 *    sparingly — typically reserved for "service degraded" notices.
 *  - startsAt / expiresAt: the row is shown only when
 *    startsAt <= now <= expiresAt. NULL = unbounded on that side.
 */
export const appAnnouncement = sqliteTable(
  "app_announcement",
  {
    id: text("id").primaryKey(),
    kind: text("kind").notNull().default("banner"),
    severity: text("severity").notNull().default("info"),
    title: text("title"),
    body: text("body").notNull(),
    ctaLabel: text("ctaLabel"),
    ctaUrl: text("ctaUrl"),
    audience: text("audience").notNull().default("all"),
    targetUserIds: text("targetUserIds"),
    status: text("status").notNull().default("active"),
    dismissable: integer("dismissable").notNull().default(1),
    startsAt: integer("startsAt", { mode: "timestamp" }),
    expiresAt: integer("expiresAt", { mode: "timestamp" }),
    createdBy: text("createdBy"),
    createdAt: integer("createdAt", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updatedAt", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    index("app_announcement_status_idx").on(table.status),
    index("app_announcement_kind_idx").on(table.kind),
    index("app_announcement_audience_idx").on(table.audience),
    index("app_announcement_window_idx").on(table.startsAt, table.expiresAt),
  ],
);

/**
 * Per-user dismissal record. Used by the desktop app to remember that a
 * 'popup' announcement has already been seen so it isn't shown again on
 * the next session. Banners use ephemeral localStorage instead.
 */
export const appAnnouncementDismissal = sqliteTable(
  "app_announcement_dismissal",
  {
    announcementId: text("announcementId")
      .notNull()
      .references(() => appAnnouncement.id, { onDelete: "cascade" }),
    userId: text("userId")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    dismissedAt: integer("dismissedAt", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    primaryKey({
      name: "app_announcement_dismissal_pk",
      columns: [table.announcementId, table.userId],
    }),
    index("app_announcement_dismissal_user_idx").on(table.userId),
  ],
);

export const liveSession = sqliteTable(
  "live_session",
  {
    id: text("id").primaryKey(),
    userId: text("userId")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    userEmail: text("userEmail"),
    surface: text("surface"),
    ipAddress: text("ipAddress"),
    userAgent: text("userAgent"),
    startedAt: integer("startedAt", { mode: "timestamp" }).notNull(),
    lastSeenAt: integer("lastSeenAt", { mode: "timestamp" }).notNull(),
    endedAt: integer("endedAt", { mode: "timestamp" }),
    endedBy: text("endedBy"),
    endReason: text("endReason"),
    deepgramKeyId: text("deepgramKeyId"),
    deepgramProjectId: text("deepgramProjectId"),
    eventCount: integer("eventCount").notNull().default(0),
    metadata: text("metadata"),
    workspaceId: text("workspaceId"),
  },
  (table) => [
    index("live_session_user_idx").on(table.userId),
    index("live_session_started_idx").on(table.startedAt),
    index("live_session_active_idx").on(table.endedAt, table.lastSeenAt),
  ],
);
