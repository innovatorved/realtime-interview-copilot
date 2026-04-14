-- Add admin dashboard fields to user table
ALTER TABLE user ADD COLUMN isBanned integer DEFAULT 0;
ALTER TABLE user ADD COLUMN banReason text;
ALTER TABLE user ADD COLUMN lastActiveAt integer;

-- Audit log table (mirrors Better Auth Infrastructure audit logs)
CREATE TABLE IF NOT EXISTS audit_event (
  id text PRIMARY KEY NOT NULL,
  eventType text NOT NULL,
  userId text REFERENCES user(id) ON DELETE SET NULL,
  userEmail text,
  ipAddress text,
  userAgent text,
  metadata text,
  createdAt integer NOT NULL
);

CREATE INDEX IF NOT EXISTS audit_event_type_idx ON audit_event(eventType);
CREATE INDEX IF NOT EXISTS audit_event_user_idx ON audit_event(userId);
CREATE INDEX IF NOT EXISTS audit_event_created_idx ON audit_event(createdAt);

-- Security event table (self-hosted Sentinel equivalent)
CREATE TABLE IF NOT EXISTS security_event (
  id text PRIMARY KEY NOT NULL,
  eventType text NOT NULL,
  ipAddress text,
  userEmail text,
  action text NOT NULL,
  metadata text,
  createdAt integer NOT NULL
);

CREATE INDEX IF NOT EXISTS security_event_type_idx ON security_event(eventType);
CREATE INDEX IF NOT EXISTS security_event_ip_idx ON security_event(ipAddress);
CREATE INDEX IF NOT EXISTS security_event_created_idx ON security_event(createdAt);

-- Rate limiting table
CREATE TABLE IF NOT EXISTS rate_limit (
  id text PRIMARY KEY NOT NULL,
  key text NOT NULL,
  count integer NOT NULL DEFAULT 0,
  windowStart integer NOT NULL,
  expiresAt integer NOT NULL
);

CREATE INDEX IF NOT EXISTS rate_limit_key_idx ON rate_limit(key);
