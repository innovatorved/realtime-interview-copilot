import { ricFetch } from "@/lib/ric-fetch";

/**
 * Allow-list of action names recognised by the worker's
 * /api/events/track endpoint. Keep in sync with
 * realtime-worker-api/src/index.ts (`ALLOWED_TRACKED_ACTIONS`).
 *
 * Anything not in this list is rejected server-side, so the type guard
 * below means typos surface at the call site instead of silently being
 * dropped on the network.
 */
export type TrackedAction =
  | "recording_start"
  | "recording_stop"
  | "screen_capture"
  | "question_asked"
  | "mode_switched"
  | "completion_saved"
  | "session_resumed"
  | "session_paused_by_user";

export interface LiveSessionStartOpts {
  surface?: "web" | "electron";
  metadata?: Record<string, unknown>;
}

export interface LiveSessionStartResult {
  sessionId: string;
  startedAt: string;
}

/** Register a new live interview session. Returns null on auth/network failure.
 *
 *  On the "you already have N active sessions" 409 (the user's previous
 *  Electron process was force-killed before its end ping fired), we
 *  automatically call `/api/sessions/end-all` and retry ONCE so the user
 *  never sees a stuck-recorder UX from a crash. We retry exactly once to
 *  avoid an unbounded loop if the worker is genuinely refusing for
 *  another reason.
 */
export async function startLiveSession(
  opts: LiveSessionStartOpts = {},
): Promise<LiveSessionStartResult | null> {
  const post = (): Promise<Response> =>
    ricFetch("/api/sessions/start", {
      method: "POST",
      body: JSON.stringify(opts),
    });

  try {
    let res = await post();
    if (res.status === 409) {
      // Stale-session cap hit — bulk-clear and retry once.
      const cleared = await endAllLiveSessions("auto_recover_from_409");
      if (cleared !== null) res = await post();
    }
    if (!res.ok) return null;
    return (await res.json()) as LiveSessionStartResult;
  } catch {
    return null;
  }
}

/**
 * Mark the live session ended. Best-effort; failures are swallowed.
 *
 * `keepalive: true` so the request survives page unload — important
 * because we call this from the recorder's unmount path.
 */
export async function endLiveSession(
  sessionId: string,
  reason: string = "user_stopped",
): Promise<void> {
  try {
    await ricFetch("/api/sessions/end", {
      method: "POST",
      body: JSON.stringify({ sessionId, reason }),
      keepalive: true,
    });
  } catch {
    // Best-effort tracking call.
  }
}

/**
 * End every active live_session row owned by the signed-in user.
 *
 * Used in two places:
 *   1. App startup, to clear zombie rows left by a force-killed Electron
 *      process whose unload hook never got to call `endLiveSession`.
 *   2. Recovery path when `startLiveSession` 409s with "you already have
 *      N active sessions" — call this and retry start once.
 *
 * Returns the number of rows ended (or null on transport failure).
 * Idempotent server-side: zero rows is a normal "all clean" response.
 */
export async function endAllLiveSessions(
  reason: string = "client_cleanup",
): Promise<number | null> {
  try {
    const res = await ricFetch("/api/sessions/end-all", {
      method: "POST",
      body: JSON.stringify({ reason }),
      keepalive: true,
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { endedCount?: number };
    return typeof body.endedCount === "number" ? body.endedCount : 0;
  } catch {
    return null;
  }
}

/**
 * Mirror an important user-side event to the worker's important-events
 * table so admins can query it. Independent of PostHog; both systems
 * receive the same event but have different consumers (PostHog for
 * product analytics, our backend for the admin dashboard).
 *
 * Designed to never throw and never block the calling code.
 */
export function trackEvent(
  action: TrackedAction,
  options: {
    sessionId?: string | null;
    metadata?: Record<string, unknown>;
  } = {},
): void {
  if (typeof window === "undefined") return;
  const body = JSON.stringify({
    action,
    sessionId: options.sessionId ?? undefined,
    metadata: options.metadata ?? {},
  });
  void ricFetch("/api/events/track", {
    method: "POST",
    body,
    keepalive: true,
  }).catch(() => {
    // Tracking is best-effort.
  });
}
