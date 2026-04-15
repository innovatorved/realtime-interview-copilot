-- Performance indexes for admin dashboard queries

-- User table indexes for filtering/sorting
CREATE INDEX IF NOT EXISTS user_approved_idx ON user(isApproved);
CREATE INDEX IF NOT EXISTS user_banned_idx ON user(isBanned);
CREATE INDEX IF NOT EXISTS user_created_idx ON user(createdAt);
CREATE INDEX IF NOT EXISTS user_last_active_idx ON user(lastActiveAt);

-- Session table indexes for admin list/count queries
CREATE INDEX IF NOT EXISTS session_user_idx ON session(userId);
CREATE INDEX IF NOT EXISTS session_expires_idx ON session(expiresAt);

-- Interview preset indexes for filtered queries
CREATE INDEX IF NOT EXISTS preset_user_idx ON interview_preset(userId);
CREATE INDEX IF NOT EXISTS preset_builtin_idx ON interview_preset(isBuiltIn);
CREATE INDEX IF NOT EXISTS preset_category_idx ON interview_preset(category);

-- Rate limit compound index for cleanup + lookup
CREATE INDEX IF NOT EXISTS rate_limit_expires_idx ON rate_limit(expiresAt);
