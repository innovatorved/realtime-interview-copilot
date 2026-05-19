/** Admin-triggered cleanup of expired rate-limit and auth-session rows. */

import { lt } from "drizzle-orm";
import { APIError, createAuthEndpoint, sessionMiddleware } from "better-auth/api";
import { rateLimitEntry, session } from "../../../db/schema";
import type { AdminDeps } from "../types";

export function cleanupEndpoints(deps: AdminDeps) {
  const { isAdmin, opts, recordAudit } = deps;
  return {
    adminCleanup: createAuthEndpoint(
      "/self-hosted-admin/cleanup",
      { method: "POST", use: [sessionMiddleware] },
      async (ctx) => {
        const adminEmail = ctx.context.session.user.email;
        if (!(await isAdmin(adminEmail))) throw new APIError("FORBIDDEN");
        const db = opts.getDb();
        const now = new Date();

        await db.delete(rateLimitEntry).where(lt(rateLimitEntry.expiresAt, now));
        await db.delete(session).where(lt(session.expiresAt, now));

        await recordAudit({
          eventType: "admin_action",
          userEmail: adminEmail,
          metadata: { action: "cleanup", timestamp: now.toISOString() },
        });
        return ctx.json({ ok: true, cleanedAt: now.toISOString() });
      },
    ),
  };
}
