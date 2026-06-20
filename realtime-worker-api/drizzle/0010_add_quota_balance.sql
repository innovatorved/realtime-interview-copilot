-- Per-user quota balance for usage-based billing (enforcement optional via env).
CREATE TABLE IF NOT EXISTS quota_balance (
  userId TEXT PRIMARY KEY NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  planTier TEXT NOT NULL DEFAULT 'legacy_unlimited',
  monthlyAllowanceSeconds INTEGER,
  monthlyAllowanceCompletions INTEGER,
  consumedSeconds INTEGER NOT NULL DEFAULT 0,
  consumedCompletions INTEGER NOT NULL DEFAULT 0,
  cycleResetAt INTEGER NOT NULL,
  overageAllowed INTEGER NOT NULL DEFAULT 1,
  createdAt INTEGER NOT NULL,
  updatedAt INTEGER NOT NULL
);

INSERT INTO quota_balance (
  userId, planTier, monthlyAllowanceSeconds, monthlyAllowanceCompletions,
  consumedSeconds, consumedCompletions, cycleResetAt, overageAllowed, createdAt, updatedAt
)
SELECT
  id,
  'legacy_unlimited',
  NULL,
  NULL,
  0,
  0,
  CAST((strftime('%s', 'now') + 2592000) AS INTEGER),
  1,
  CAST(strftime('%s', 'now') AS INTEGER),
  CAST(strftime('%s', 'now') AS INTEGER)
FROM user
WHERE NOT EXISTS (
  SELECT 1 FROM quota_balance qb WHERE qb.userId = user.id
);
