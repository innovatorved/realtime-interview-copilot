/** Admin allow-list resolver.
 *
 *  The effective admin set is the union of env-derived emails (passed in
 *  at deploy time) and the `admin_emails` row in `admin_config`. The
 *  merged set is cached for 30 s so writes take effect quickly without
 *  hitting D1 on every request. */

import { eq } from "drizzle-orm";
import { adminConfig, user } from "../../../db/schema";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import type * as schemaTypes from "../../../db/schema";

const ADMIN_SET_TTL_MS = 30_000;
const PRIMARY_ADMIN_EMAIL = "admin@vedgupta.in";

type DbHandle = DrizzleD1Database<typeof schemaTypes>;

export function createAdminSet(envAdmins: Set<string>, getDb: () => DbHandle) {
  let adminSetCache: { value: Set<string>; expires: number } | null = null;

  async function getAdminSet(): Promise<Set<string>> {
    const now = Date.now();
    if (adminSetCache && adminSetCache.expires > now) return adminSetCache.value;
    const merged = new Set(envAdmins);
    merged.add(PRIMARY_ADMIN_EMAIL);
    try {
      const [configRows, roleAdmins] = await Promise.all([
        getDb()
          .select({ value: adminConfig.value })
          .from(adminConfig)
          .where(eq(adminConfig.key, "admin_emails")),
        getDb()
          .select({ email: user.email })
          .from(user)
          .where(eq(user.role, "admin")),
      ]);
      const row = configRows[0];
      if (row?.value) {
        for (const e of row.value
          .split(",")
          .map((s) => s.trim().toLowerCase())
          .filter(Boolean)) {
          merged.add(e);
        }
      }
      for (const r of roleAdmins) {
        if (r.email) {
          merged.add(r.email.trim().toLowerCase());
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
