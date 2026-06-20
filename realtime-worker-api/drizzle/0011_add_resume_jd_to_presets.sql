-- Resume / job-description context on presets (text only, no binary storage).
ALTER TABLE interview_preset ADD COLUMN resumeText TEXT;
ALTER TABLE interview_preset ADD COLUMN resumeFileName TEXT;
ALTER TABLE interview_preset ADD COLUMN jobDescription TEXT;
ALTER TABLE interview_preset ADD COLUMN updatedAt INTEGER;

CREATE TABLE IF NOT EXISTS preset_user_context (
  userId TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  presetId TEXT NOT NULL REFERENCES interview_preset(id) ON DELETE CASCADE,
  resumeText TEXT,
  resumeFileName TEXT,
  jobDescription TEXT,
  updatedAt INTEGER NOT NULL,
  PRIMARY KEY (userId, presetId)
);
