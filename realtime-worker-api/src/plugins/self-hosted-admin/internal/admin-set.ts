/** Admin allow-list resolver.
 *
 *  The effective admin set is the union of env-derived emails (passed in
 *  at deploy time) and the `admin_emails` row in `admin_config`. The
 *  merged set is cached for 30 s so writes take effect quickly without
 *  hitting D1 on every request. */

import { eq } from "drizzle-orm";
import { adminConfig } from "../../../db/schema";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import type * as schemaTypes from "../../../db/schema";

const ADMIN_SET_TTL_MS = 30_000;

type DbHandle = DrizzleD1Database<typeof schemaTypes>;

export function createAdminSet(envAdmins: Set<string>, getDb: () => DbHandle) {
  let adminSetCache: { value: Set<string>; expires: number } | null = null;

  async function getAdminSet(): Promise<Set<string>> {
    const now = Date.now();
    if (adminSetCache && adminSetCache.expires > now) return adminSetCache.value;
    const merged = new Set(envAdmins);
    try {
      const [row] = await getDb()
        .select({ value: adminConfig.value })
        .from(adminConfig)
        .where(eq(adminConfig.key, "admin_emails"));
      if (row?.value) {
        for (const e of row.value
          .split(",")
          .map((s) => s.trim().toLowerCase())
          .filter(Boolean)) {
          merged.add(e);
        }
      }
    } catch (e) {
      console.warn(
        "[SelfHostedAdmin] admin_emails load failed, using env only:",
        e,
      );
    }
    adminSetCache = { value: merged, expires: now + ADMIN_SET_TTL_MS };
    return merged;
  }

  function invalidateAdminSetCache() {
    adminSetCache = null;
  }

  async function isAdmin(email: string): Promise<boolean> {
    const set = await getAdminSet();
    return set.size > 0 && set.has(email.toLowerCase());
  }

  return { isAdmin, invalidateAdminSetCache };
}
