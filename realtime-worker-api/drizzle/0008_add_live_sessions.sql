-- Live interview sessions. One row per "Start Listening" press from the
-- recorder. See src/db/schema.ts (`liveSession`) for column docs.
CREATE TABLE IF NOT EXISTS live_session (
  id text PRIMARY KEY NOT NULL,
  userId text NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  userEmail text,
  presetId text,
  presetName text,
  surface text,
  ipAddress text,
  userAgent text,
  startedAt integer NOT NULL,
  lastSeenAt integer NOT NULL,
  endedAt integer,
  endedBy text,
  endReason text,
  -- Latest minted Deepgram key for this session. Lets admins terminate
  -- a live recording by deleting the key upstream so the candidate's
  -- WebSocket dies on the next audio chunk (no client polling needed).
  deepgramKeyId text,
  deepgramProjectId text,
  eventCount integer NOT NULL DEFAULT 0,
  metadata text
);

CREATE INDEX IF NOT EXISTS live_session_user_idx    ON live_session(userId);
CREATE INDEX IF NOT EXISTS live_session_started_idx ON live_session(startedAt);
CREATE INDEX IF NOT EXISTS live_session_active_idx  ON live_session(endedAt, lastSeenAt);
