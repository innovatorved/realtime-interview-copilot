-- Support messages: lets pending/approved users send a message to admins
-- (typical use: explain who they are while waiting for access). Admins can
-- reply via `parentId` threads.
--
-- See src/db/schema.ts (`supportMessage`) for column docs.
CREATE TABLE IF NOT EXISTS support_message (
  id text PRIMARY KEY NOT NULL,
  userId text REFERENCES user(id) ON DELETE CASCADE,
  userEmail text,
  userName text,
  parentId text REFERENCES support_message(id) ON DELETE CASCADE,
  -- 'user' = written by the end-user, 'admin' = written by an administrator
  authorType text NOT NULL,
  authorEmail text,
  subject text,
  body text NOT NULL,
  -- Status of the *thread root* row only. Reply rows always carry status
  -- = 'reply' so admin filters can hide them.
  status text NOT NULL DEFAULT 'open',
  -- True once an admin has read the user's message; false again whenever
  -- the user posts a follow-up. Powers the "unread" badge on the dashboard.
  unreadByAdmin integer NOT NULL DEFAULT 1,
  -- Mirror of the above for the user side: true once the user has seen
  -- the latest admin reply (used by the desktop app to show a dot).
  unreadByUser integer NOT NULL DEFAULT 0,
  ipAddress text,
  userAgent text,
  metadata text,
  createdAt integer NOT NULL,
  updatedAt integer NOT NULL
);

CREATE INDEX IF NOT EXISTS support_message_user_idx     ON support_message(userId);
CREATE INDEX IF NOT EXISTS support_message_parent_idx   ON support_message(parentId);
CREATE INDEX IF NOT EXISTS support_message_status_idx   ON support_message(status);
CREATE INDEX IF NOT EXISTS support_message_unread_idx   ON support_message(unreadByAdmin);
CREATE INDEX IF NOT EXISTS support_message_created_idx  ON support_message(createdAt);

-- App announcements: admin-controlled banners and popups shown inside the
-- desktop app. Targeted to either a specific user, a list of user ids, or
-- everyone.
--
-- See src/db/schema.ts (`appAnnouncement`) for column docs.
CREATE TABLE IF NOT EXISTS app_announcement (
  id text PRIMARY KEY NOT NULL,
  -- 'banner'  → top-of-app strip, persistent until dismissed/expires
  -- 'popup'   → modal shown once per user, dismissed forever after ack
  -- 'toast'   → ephemeral non-blocking notification
  kind text NOT NULL DEFAULT 'banner',
  -- 'info' | 'success' | 'warning' | 'error' | 'announcement'
  severity text NOT NULL DEFAULT 'info',
  title text,
  body text NOT NULL,
  -- Optional CTA: button shown next to the message
  ctaLabel text,
  ctaUrl text,
  -- Targeting: 'all' (everyone) or 'users' (limited to userIds list)
  audience text NOT NULL DEFAULT 'all',
  -- JSON-encoded array of user ids when audience = 'users'. NULL otherwise.
  -- Capped at 5000 ids by the API to keep the payload sane.
  targetUserIds text,
  -- 'active' | 'paused' | 'archived'. Only 'active' rows get returned to
  -- the client.
  status text NOT NULL DEFAULT 'active',
  -- If 1, popup is dismissable by the user (banners always are). If 0, the
  -- user has no dismiss button — useful for "service degraded" notices.
  dismissable integer NOT NULL DEFAULT 1,
  startsAt integer,
  expiresAt integer,
  createdBy text,
  createdAt integer NOT NULL,
  updatedAt integer NOT NULL
);

CREATE INDEX IF NOT EXISTS app_announcement_status_idx   ON app_announcement(status);
CREATE INDEX IF NOT EXISTS app_announcement_kind_idx     ON app_announcement(kind);
CREATE INDEX IF NOT EXISTS app_announcement_audience_idx ON app_announcement(audience);
CREATE INDEX IF NOT EXISTS app_announcement_window_idx   ON app_announcement(startsAt, expiresAt);

-- Per-user dismissal tracking. Exists only for 'popup' kind (banners can
-- be dismissed for the current session via localStorage in the client).
CREATE TABLE IF NOT EXISTS app_announcement_dismissal (
  announcementId text NOT NULL REFERENCES app_announcement(id) ON DELETE CASCADE,
  userId text NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  dismissedAt integer NOT NULL,
  PRIMARY KEY (announcementId, userId)
);

CREATE INDEX IF NOT EXISTS app_announcement_dismissal_user_idx
  ON app_announcement_dismissal(userId);
