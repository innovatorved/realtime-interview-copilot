/** Log security events to D1 (best-effort). */

import type { DrizzleD1Database } from "drizzle-orm/d1";
import { securityEvent } from "../db/schema";

type Db = DrizzleD1Database<Record<string, never>>;

export async function recordSecurityEvent(
  db: Db,
  opts: {
    eventType: string;
    action: string;
    ipAddress?: string | null;
    userEmail?: string | null;
    metadata?: Record<string, unknown>;
  },
): Promise<void> {
  try {
    await db.insert(securityEvent).values({
      id: crypto.randomUUID(),
      eventType: opts.eventType,
      action: opts.action,
      ipAddress: opts.ipAddress ?? null,
      userEmail: opts.userEmail ?? null,
      metadata: opts.metadata ? JSON.stringify(opts.metadata).slice(0, 4000) : null,
      createdAt: new Date(),
    });
  } catch (e) {
    console.warn("[security] recordSecurityEvent failed:", e);
  }
}
