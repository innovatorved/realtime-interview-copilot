/** Session resolution + approval / ban gate.
 *
 *  `getAuthenticatedUser` enforces approved + non-banned. Use it for any
 *  endpoint that costs money or exposes sensitive data.
 *
 *  `getAuthenticatedUserAllowPending` is the lenient variant used only for
 *  support messaging — a pending user can still write to admins. Banned
 *  users are still rejected. */

import { eq } from "drizzle-orm";
import { auth } from "../auth";
import { getDb } from "../db";
import { user as userTable } from "../db/schema";
import { KV, KV_TTL_SECONDS } from "../kv-keys";
import { jsonResponse } from "../lib/http";
import type { Env } from "../env";

export type AuthFailureReason = "unauthorized" | "pending_approval" | "banned";

export interface AuthedUser {
  id: string;
  email: string;
  name: string;
}

export async function getAuthenticatedUser(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
): Promise<AuthedUser | { error: AuthFailureReason }> {
  let session;
  try {
    session = await auth(env).api.getSession({ headers: request.headers });
  } catch (e) {
    console.warn("[Worker] getSession failed:", e);
    return { error: "unauthorized" };
  }
  if (!session?.user) return { error: "unauthorized" };

  const userId = session.user.id;

  let flags: { isApproved: boolean | null; isBanned: boolean | null } | null =
    null;
  try {
    const rows = await getDb(env)
      .select({
        isApproved: userTable.isApproved,
        isBanned: userTable.isBanned,
      })
      .from(userTable)
      .where(eq(userTable.id, userId))
      .limit(1);
    flags = rows[0] ?? null;
  } catch (e) {
    console.warn("[Worker] flag lookup failed:", e);
    return { error: "unauthorized" };
  }

  if (flags?.isBanned === true) return { error: "banned" };
  if (flags?.isApproved !== true) return { error: "pending_approval" };

  // KV-backed throttle so lastActiveAt writes happen at most every 5 minutes
  // per user, consistent across isolates.
  if (env.CONFIG_KV) {
    const key = KV.userActivity(userId);
    const seen = await env.CONFIG_KV.get(key).catch(() => null);
    if (!seen) {
      ctx.waitUntil(
        (async () => {
          try {
            await env.CONFIG_KV!.put(key, "1", {
              expirationTtl: KV_TTL_SECONDS.userActivity,
            });
            await getDb(env)
              .update(userTable)
              .set({ lastActiveAt: new Date() })
              .where(eq(userTable.id, userId))
              .execute();
          } catch (e) {
            console.warn("[Worker] activity update failed:", e);
          }
        })(),
      );
    }
  }

  return {
    id: userId,
    email: session.user.email,
    name: session.user.name,
  };
}

export function authErrorResponse(reason: AuthFailureReason): Response {
  switch (reason) {
    case "banned":
      return jsonResponse({ error: "Account suspended" }, 403);
    case "pending_approval":
      return jsonResponse({ error: "Account pending approval" }, 403);
    case "unauthorized":
    default:
      return jsonResponse({ error: "Unauthorized" }, 401);
  }
}

export function isAuthed(
  result: AuthedUser | { error: AuthFailureReason },
): result is AuthedUser {
  return !("error" in result);
}

/** Lenient variant of getAuthenticatedUser that lets pending-approval users
 *  through. This is the *only* auth gate we expose to pending users — used
 *  exclusively for support messaging so a user waiting for approval can
 *  still write to the admin. Banned users are still rejected because they
 *  may be banned for abuse. */
export async function getAuthenticatedUserAllowPending(
  request: Request,
  env: Env,
): Promise<AuthedUser | { error: AuthFailureReason; isPending?: boolean }> {
  let session;
  try {
    session = await auth(env).api.getSession({ headers: request.headers });
  } catch (e) {
    console.warn("[Worker] getSession failed:", e);
    return { error: "unauthorized" };
  }
  if (!session?.user) return { error: "unauthorized" };

  const userId = session.user.id;

  let flags: { isApproved: boolean | null; isBanned: boolean | null } | null =
    null;
  try {
    const rows = await getDb(env)
      .select({
        isApproved: userTable.isApproved,
        isBanned: userTable.isBanned,
      })
      .from(userTable)
      .where(eq(userTable.id, userId))
      .limit(1);
    flags = rows[0] ?? null;
  } catch (e) {
    console.warn("[Worker] flag lookup failed:", e);
    return { error: "unauthorized" };
  }

  if (flags?.isBanned === true) return { error: "banned" };

  return {
    id: userId,
    email: session.user.email,
    name: session.user.name,
  };
}
