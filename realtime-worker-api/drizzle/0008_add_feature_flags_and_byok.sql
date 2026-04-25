-- Generic per-user feature flag table. ONE table serves every flag forever:
-- adding a new flag = adding an entry to src/feature-flags/registry.ts.
-- See src/db/schema.ts (`featureFlag`) for column docs.
CREATE TABLE IF NOT EXISTS feature_flag (
  id text PRIMARY KEY NOT NULL,
  userId text NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  flagKey text NOT NULL,
  enabled integer NOT NULL DEFAULT 0,
  valueJson text,
  updatedAt integer NOT NULL,
  updatedByEmail text
);
CREATE UNIQUE INDEX IF NOT EXISTS feature_flag_user_key_idx ON feature_flag (userId, flagKey);
CREATE INDEX IF NOT EXISTS feature_flag_key_idx ON feature_flag (flagKey);

-- BYOK credentials. Tokens are AES-GCM encrypted at rest using the worker
-- secret `BYOK_ENC_KEY`. See src/db/schema.ts (`byokCredential`) for docs.
CREATE TABLE IF NOT EXISTS byok_credential (
  id text PRIMARY KEY NOT NULL,
  userId text NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  provider text NOT NULL,
  baseUrl text NOT NULL,
  tokenCiphertext text NOT NULL,
  tokenIv text NOT NULL,
  tokenLast4 text NOT NULL,
  modelName text,
  active integer NOT NULL DEFAULT 1,
  disabledByAdmin integer NOT NULL DEFAULT 0,
  createdAt integer NOT NULL,
  updatedAt integer NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS byok_user_provider_idx ON byok_credential (userId, provider);
