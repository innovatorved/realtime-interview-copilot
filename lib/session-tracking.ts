import { BACKEND_API_URL } from "@/lib/constant";

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
  | "preset_loaded"
  | "session_resumed"
  | "session_paused_by_user";

export interface LiveSessionStartOpts {
  presetId?: string | null;
  presetName?: string | null;
  surface?: "web" | "electron";
  metadata?: Record<string, unknown>;
}

export interface LiveSessionStartResult {
  sessionId: string;
  startedAt: string;
}

/** Register a new live interview session. Returns null on auth/network failure. */
export async function startLiveSession(
  opts: LiveSessionStartOpts = {},
): Promise<LiveSessionStartResult | null> {
  try {
    const res = await fetch(`${BACKEND_API_URL}/api/sessions/start`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(opts),
    });
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
    await fetch(`${BACKEND_API_URL}/api/sessions/end`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId, reason }),
      keepalive: true,
    });
  } catch {
    // Best-effort tracking call.
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
  options: { sessionId?: string | null; metadata?: Record<string, unknown> } = {},
): void {
  if (typeof window === "undefined") return;
  const body = JSON.stringify({
    action,
    sessionId: options.sessionId ?? undefined,
    metadata: options.metadata ?? {},
  });
  void fetch(`${BACKEND_API_URL}/api/events/track`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body,
    keepalive: true,
  }).catch(() => {
    // Tracking is best-effort.
  });
}
