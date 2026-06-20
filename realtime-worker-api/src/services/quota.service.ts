/** Quota balance read/write — enforcement gated by env flags. */

import { eq, sql } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import adminCfg from "../config.json";
import { quotaBalance } from "../db/schema";
import type { Env } from "../env";

export type QuotaAction = "completion" | "deepgram_seconds";

export type QuotaPlanTier =
  | "legacy_unlimited"
  | "free_tier"
  | "early_access"
  | "unlimited";

export type QuotaRow = typeof quotaBalance.$inferSelect;

export type QuotaSummary = {
  planTier: string;
  monthlyAllowanceSeconds: number | null;
  monthlyAllowanceCompletions: number | null;
  consumedSeconds: number;
  consumedCompletions: number;
  remainingSeconds: number | null;
  remainingCompletions: number | null;
  cycleResetAt: string;
  overageAllowed: boolean;
  enforcementEnabled: boolean;
  recordConsumption: boolean;
};

type Db = DrizzleD1Database<Record<string, never>>;

function quotaFlags(env: Env) {
  return {
    enforce: env.QUOTA_ENFORCEMENT === "true",
    record: env.QUOTA_RECORD_CONSUMPTION !== "false",
  };
}

const CYCLE_MS = 30 * 86_400_000;

export async function maybeResetCycle(db: Db, row: QuotaRow): Promise<void> {
  const now = Date.now();
  const resetAt = row.cycleResetAt?.getTime() ?? 0;
  if (resetAt > now) return;

  const nextReset = new Date(now + CYCLE_MS);
  await db
    .update(quotaBalance)
    .set({
      consumedSeconds: 0,
      consumedCompletions: 0,
      cycleResetAt: nextReset,
      updatedAt: new Date(),
    })
    .where(eq(quotaBalance.userId, row.userId));
}

export async function ensureQuotaRow(db: Db, userId: string): Promise<void> {
  const now = new Date();
  const cycleResetAt = new Date(now.getTime() + CYCLE_MS);
  await db
    .insert(quotaBalance)
    .values({
      userId,
      planTier: "legacy_unlimited",
      monthlyAllowanceSeconds: null,
      monthlyAllowanceCompletions: null,
      consumedSeconds: 0,
      consumedCompletions: 0,
      cycleResetAt,
      overageAllowed: true,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing();
}

export async function getQuotaForUser(
  db: Db,
  userId: string,
): Promise<QuotaRow | null> {
  const [row] = await db
    .select()
    .from(quotaBalance)
    .where(eq(quotaBalance.userId, userId))
    .limit(1);
  return row ?? null;
}

function computeRemaining(
  allowance: number | null | undefined,
  consumed: number,
): number | null {
  if (allowance == null) return null;
  return Math.max(0, allowance - consumed);
}

export function toQuotaSummary(row: QuotaRow | null, env: Env): QuotaSummary {
  const flags = quotaFlags(env);
  if (!row) {
    return {
      planTier: "legacy_unlimited",
      monthlyAllowanceSeconds: null,
      monthlyAllowanceCompletions: null,
      consumedSeconds: 0,
      consumedCompletions: 0,
      remainingSeconds: null,
      remainingCompletions: null,
      cycleResetAt: new Date(Date.now() + CYCLE_MS).toISOString(),
      overageAllowed: true,
      enforcementEnabled: flags.enforce,
      recordConsumption: flags.record,
    };
  }

  return {
    planTier: row.planTier,
    monthlyAllowanceSeconds: row.monthlyAllowanceSeconds,
    monthlyAllowanceCompletions: row.monthlyAllowanceCompletions,
    consumedSeconds: row.consumedSeconds,
    consumedCompletions: row.consumedCompletions,
    remainingSeconds: computeRemaining(
      row.monthlyAllowanceSeconds,
      row.consumedSeconds,
    ),
    remainingCompletions: computeRemaining(
      row.monthlyAllowanceCompletions,
      row.consumedCompletions,
    ),
    cycleResetAt: row.cycleResetAt.toISOString(),
    overageAllowed: row.overageAllowed,
    enforcementEnabled: flags.enforce,
    recordConsumption: flags.record,
  };
}

export async function checkQuota(
  db: Db,
  env: Env,
  userId: string,
  _action: QuotaAction,
): Promise<{ allowed: true } | { allowed: false; resetAt: Date }> {
  if (!quotaFlags(env).enforce) return { allowed: true };

  const row = await getQuotaForUser(db, userId);
  if (!row) return { allowed: true };

  await maybeResetCycle(db, row);
  const fresh = (await getQuotaForUser(db, userId)) ?? row;

  const secondsCap = fresh.monthlyAllowanceSeconds;
  const completionsCap = fresh.monthlyAllowanceCompletions;
  const unlimited = secondsCap == null && completionsCap == null;
  if (unlimited || fresh.overageAllowed) return { allowed: true };

  const secondsOk =
    secondsCap == null || fresh.consumedSeconds < secondsCap;
  const completionsOk =
    completionsCap == null || fresh.consumedCompletions < completionsCap;

  if (secondsOk && completionsOk) return { allowed: true };
  return { allowed: false, resetAt: fresh.cycleResetAt };
}

export async function consumeQuota(
  db: Db,
  env: Env,
  userId: string,
  _action: QuotaAction,
  amount: { seconds?: number; completions?: number },
): Promise<void> {
  if (!quotaFlags(env).record) return;

  const deltaSeconds = Math.max(0, amount.seconds ?? 0);
  const deltaCompletions = Math.max(0, amount.completions ?? 0);
  if (deltaSeconds === 0 && deltaCompletions === 0) return;

  await ensureQuotaRow(db, userId);

  await db
    .update(quotaBalance)
    .set({
      consumedSeconds: sql`${quotaBalance.consumedSeconds} + ${deltaSeconds}`,
      consumedCompletions: sql`${quotaBalance.consumedCompletions} + ${deltaCompletions}`,
      updatedAt: new Date(),
    })
    .where(eq(quotaBalance.userId, userId));
}

export function getQuotaTierCatalog() {
  const quota = (adminCfg as { quota?: { defaultTierForNewUsers?: string; tiers?: Record<string, { monthlyAllowanceSeconds: number | null; monthlyAllowanceCompletions: number | null }> } }).quota;
  return {
    defaultTierForNewUsers: quota?.defaultTierForNewUsers ?? "legacy_unlimited",
    tiers: quota?.tiers ?? {
      legacy_unlimited: {
        monthlyAllowanceSeconds: null,
        monthlyAllowanceCompletions: null,
      },
      free_tier: { monthlyAllowanceSeconds: 3600, monthlyAllowanceCompletions: 500 },
    },
  };
}
