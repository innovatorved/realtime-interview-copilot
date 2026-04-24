-- Per-user LLM generation parameter overrides. NULL columns inherit the
-- global defaults stored in admin_config. See src/db/schema.ts
-- (`userModelParams`) for details.
CREATE TABLE IF NOT EXISTS user_model_params (
  userId text PRIMARY KEY NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  maxOutputTokens integer,
  temperature real,
  topP real,
  thinkingBudget text,
  updatedAt integer NOT NULL
);
