-- Per-user usage tracking. One row per tracked API call. See
-- src/db/schema.ts (`usageEvent`) for column docs.
CREATE TABLE IF NOT EXISTS usage_event (
  id text PRIMARY KEY NOT NULL,
  userId text REFERENCES user(id) ON DELETE CASCADE,
  userEmail text,
  action text NOT NULL,
  flag text,
  model text,
  promptChars integer DEFAULT 0,
  responseChars integer DEFAULT 0,
  durationMs integer DEFAULT 0,
  status text NOT NULL DEFAULT 'ok',
  errorCode text,
  ipAddress text,
  userAgent text,
  metadata text,
  createdAt integer NOT NULL
);

CREATE INDEX IF NOT EXISTS usage_event_user_created_idx ON usage_event(userId, createdAt);
CREATE INDEX IF NOT EXISTS usage_event_action_idx        ON usage_event(action);
CREATE INDEX IF NOT EXISTS usage_event_created_idx       ON usage_event(createdAt);
CREATE INDEX IF NOT EXISTS usage_event_status_idx        ON usage_event(status);
