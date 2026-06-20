-- Remove preset system; add per-user interview context (resume + JD + notes).
DROP TABLE IF EXISTS preset_user_context;
DROP TABLE IF EXISTS interview_preset;

CREATE TABLE IF NOT EXISTS user_interview_context (
  userId TEXT PRIMARY KEY NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  interviewNotes TEXT,
  resumeText TEXT,
  resumeFileName TEXT,
  jobDescription TEXT,
  updatedAt INTEGER NOT NULL
);

-- SQLite 3.35+ / D1: drop unused live_session preset columns.
ALTER TABLE live_session DROP COLUMN presetId;
ALTER TABLE live_session DROP COLUMN presetName;
