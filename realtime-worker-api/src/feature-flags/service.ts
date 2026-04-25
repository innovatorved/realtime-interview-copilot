/**
 * Reusable feature-flag service. Built ONCE — every future flag plugs
 * into the same module via `src/feature-flags/registry.ts`.
 *
 * Read API:  isEnabled / getFlag / listForUser / listForFlag
 * Write API: setFlag / clearFlag
 *
 * Hot-path callers (`requireFlag`) should use `isEnabled` which reads from
 * an isolate-local cache (30s TTL) so we never hammer D1 on every request.
 * The cache is invalidated whenever `setFlag` or `clearFlag` runs in the
 * same isolate; cross-isolate writes converge within `CACHE_TTL_MS`.
 */

import { and, eq, inArray } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import { featureFlag } from "../db/schema";
import type * as schemaTypes from "../db/schema";
import {
  FLAG_KEYS,
  FLAG_REGISTRY,
  getFlagDefinition,
  isKnownFlag,
  type FlagKey,
} from "./registry";

type Db = DrizzleD1Database<typeof schemaTypes>;

const CACHE_TTL_MS = 30_000;

interface CacheEntry {
  flags: Record<FlagKey, FlagState>;
  expiresAt: number;
}

export interface FlagState {
  enabled: boolean;
  /** Parsed value when the registry declares `hasValue`, else null. */
  value: unknown;
}

const userCache = new Map<string, CacheEntry>();

function safeParseJson(raw: string | null | undefined): unknown {
  if (raw == null) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function defaultStateFor(key: FlagKey): FlagState {
  return { enabled: getFlagDefinition(key).defaultEnabled, value: null };
}

function defaultsForAll(): Record<FlagKey, FlagState> {
  const out = {} as Record<FlagKey, FlagState>;
  for (const k of FLAG_KEYS) out[k] = defaultStateFor(k);
  return out;
}

async function loadFlagsForUser(
  db: Db,
  userId: string,
): Promise<Record<FlagKey, FlagState>> {
  const rows = await db
    .select({
      flagKey: featureFlag.flagKey,
      enabled: featureFlag.enabled,
      valueJson: featureFlag.valueJson,
    })
    .from(featureFlag)
    .where(eq(featureFlag.userId, userId));

  const out = defaultsForAll();
  for (const row of rows) {
    if (!isKnownFlag(row.flagKey)) continue;
    out[row.flagKey] = {
      enabled: row.enabled === true,
      value: getFlagDefinition(row.flagKey).hasValue
        ? safeParseJson(row.valueJson)
        : null,
    };
  }
  return out;
}

async function getCachedFlags(
  db: Db,
  userId: string,
): Promise<Record<FlagKey, FlagState>> {
  const now = Date.now();
  const cached = userCache.get(userId);
  if (cached && cached.expiresAt > now) return cached.flags;

  const flags = await loadFlagsForUser(db, userId);
  userCache.set(userId, { flags, expiresAt: now + CACHE_TTL_MS });
  return flags;
}

/** Invalidate the in-isolate cache for a user (used after writes). */
export function invalidateFlagCache(userId: string): void {
  userCache.delete(userId);
}

/** Hot-path boolean check. Cached. */
export async function isEnabled(
  db: Db,
  userId: string,
  key: FlagKey,
): Promise<boolean> {
  const flags = await getCachedFlags(db, userId);
  return flags[key]?.enabled === true;
}

export async function getFlag(
  db: Db,
  userId: string,
  key: FlagKey,
): Promise<FlagState> {
  const flags = await getCachedFlags(db, userId);
  return flags[key] ?? defaultStateFor(key);
}

/** Returns ALL flags for a user, merged with registry defaults. */
export async function listForUser(
  db: Db,
  userId: string,
): Promise<Array<{ key: FlagKey; enabled: boolean; value: unknown; description: string }>> {
  const flags = await getCachedFlags(db, userId);
  return FLAG_KEYS.map((key) => ({
    key,
    enabled: flags[key].enabled,
    value: flags[key].value,
    description: FLAG_REGISTRY[key].description,
  }));
}

/** Returns rows for a specific flag (paginated). Bypasses the user cache. */
export async function listForFlag(
  db: Db,
  key: FlagKey,
  opts: { limit: number; offset: number } = { limit: 100, offset: 0 },
): Promise<Array<{ userId: string; enabled: boolean; value: unknown; updatedAt: Date }>> {
  const rows = await db
    .select({
      userId: featureFlag.userId,
      enabled: featureFlag.enabled,
      valueJson: featureFlag.valueJson,
      updatedAt: featureFlag.updatedAt,
    })
    .from(featureFlag)
    .where(eq(featureFlag.flagKey, key))
    .limit(opts.limit)
    .offset(opts.offset);

  return rows.map((r) => ({
    userId: r.userId,
    enabled: r.enabled === true,
    value: getFlagDefinition(key).hasValue ? safeParseJson(r.valueJson) : null,
    updatedAt: r.updatedAt,
  }));
}

/**
 * Bulk-load a single flag for many users (one query). Used by admin
 * `list-users` to render flag columns inline without N+1.
 */
export async function getFlagForUsers(
  db: Db,
  key: FlagKey,
  userIds: string[],
): Promise<Map<string, boolean>> {
  if (userIds.length === 0) return new Map();
  const rows = await db
    .select({ userId: featureFlag.userId, enabled: featureFlag.enabled })
    .from(featureFlag)
    .where(
      and(eq(featureFlag.flagKey, key), inArray(featureFlag.userId, userIds)),
    );
  const out = new Map<string, boolean>();
  for (const r of rows) out.set(r.userId, r.enabled === true);
  return out;
}

export interface SetFlagInput {
  userId: string;
  key: FlagKey;
  enabled: boolean;
  value?: unknown;
  adminEmail?: string | null;
}

export interface SetFlagResult {
  before: { enabled: boolean; value: unknown } | null;
  after: { enabled: boolean; value: unknown };
}

export async function setFlag(
  db: Db,
  input: SetFlagInput,
): Promise<SetFlagResult> {
  const def = getFlagDefinition(input.key);
  if (!def.hasValue && input.value !== undefined && input.value !== null) {
    throw new Error(
      `Flag "${input.key}" is boolean-only; value payloads are not allowed`,
    );
  }
  const valueJson =
    def.hasValue && input.value !== undefined && input.value !== null
      ? JSON.stringify(input.value)
      : null;

  const now = new Date();
  const [existing] = await db
    .select({
      id: featureFlag.id,
      enabled: featureFlag.enabled,
      valueJson: featureFlag.valueJson,
    })
    .from(featureFlag)
    .where(
      and(
        eq(featureFlag.userId, input.userId),
        eq(featureFlag.flagKey, input.key),
      ),
    );

  const before = existing
    ? {
        enabled: existing.enabled === true,
        value: def.hasValue ? safeParseJson(existing.valueJson) : null,
      }
    : null;

  if (existing) {
    await db
      .update(featureFlag)
      .set({
        enabled: input.enabled,
        valueJson,
        updatedAt: now,
        updatedByEmail: input.adminEmail ?? null,
      })
      .where(eq(featureFlag.id, existing.id));
  } else {
    await db.insert(featureFlag).values({
      id: crypto.randomUUID(),
      userId: input.userId,
      flagKey: input.key,
      enabled: input.enabled,
      valueJson,
      updatedAt: now,
      updatedByEmail: input.adminEmail ?? null,
    });
  }

  invalidateFlagCache(input.userId);

  return {
    before,
    after: {
      enabled: input.enabled,
      value: def.hasValue ? safeParseJson(valueJson) : null,
    },
  };
}

export async function clearFlag(
  db: Db,
  userId: string,
  key: FlagKey,
): Promise<void> {
  await db
    .delete(featureFlag)
    .where(and(eq(featureFlag.userId, userId), eq(featureFlag.flagKey, key)));
  invalidateFlagCache(userId);
}
