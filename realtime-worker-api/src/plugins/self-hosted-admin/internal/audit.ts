/** Audit / security event writers — factories take the db handle and return
 *  closure-style recorders so callers don't have to thread the db through. */

import { auditEvent, securityEvent } from "../../../db/schema";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import type * as schemaTypes from "../../../db/schema";
import type {
  AuditEventType,
  SecurityAction,
  SecurityEventType,
} from "../types";

type DbHandle = DrizzleD1Database<typeof schemaTypes>;

export function createRecordAudit(getDb: () => DbHandle) {
  return async function recordAudit(params: {
    eventType: AuditEventType;
    userId?: string | null;
    userEmail?: string | null;
    ipAddress?: string | null;
    userAgent?: string | null;
    metadata?: Record<string, unknown>;
  }) {
    try {
      const db = getDb();
      await db.insert(auditEvent).values({
        id: crypto.randomUUID(),
        eventType: params.eventType,
        userId: params.userId ?? null,
        userEmail: params.userEmail ?? null,
        ipAddress: params.ipAddress ?? null,
        userAgent: params.userAgent ?? null,
        metadata: params.metadata ? JSON.stringify(params.metadata) : null,
        createdAt: new Date(),
      });
    } catch (e) {
      console.error("[SelfHostedAdmin] audit write failed:", e);
    }
  };
}

export function createRecordSecurity(getDb: () => DbHandle) {
  return async function recordSecurity(params: {
    eventType: SecurityEventType;
    ipAddress?: string | null;
    userEmail?: string | null;
    action: SecurityAction;
    metadata?: Record<string, unknown>;
  }) {
    try {
      const db = getDb();
      await db.insert(securityEvent).values({
        id: crypto.randomUUID(),
        eventType: params.eventType,
        ipAddress: params.ipAddress ?? null,
        userEmail: params.userEmail ?? null,
        action: params.action,
        metadata: params.metadata ? JSON.stringify(params.metadata) : null,
        createdAt: new Date(),
      });
    } catch (e) {
      console.error("[SelfHostedAdmin] security write failed:", e);
    }
  };
}
