-- Future workspace / teams support (nullable, no behavior change today).
CREATE TABLE IF NOT EXISTS workspace (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  ownerUserId TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  createdAt INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS workspace_member (
  workspaceId TEXT NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  userId TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'member',
  joinedAt INTEGER NOT NULL,
  PRIMARY KEY (workspaceId, userId)
);

ALTER TABLE live_session ADD COLUMN workspaceId TEXT;
ALTER TABLE saved_note ADD COLUMN workspaceId TEXT;
ALTER TABLE usage_event ADD COLUMN workspaceId TEXT;
