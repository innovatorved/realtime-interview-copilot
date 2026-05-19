/**
 * Centralised client-side debug flag. One switch controls debug logging
 * across the entire Ask AI pipeline (mic, push-to-talk, completion fetch,
 * SSE stream, debug HUD).
 *
 * Three ways to flip it on (in priority order — URL beats localStorage
 * beats environment):
 *
 *   1. URL param           `?debug=1`   (or `=0` to force OFF in dev)
 *   2. localStorage         `app_debug=1`
 *   3. NODE_ENV !== "production"  → ON automatically in `next dev`
 *
 * Cached on the first call so reading the URL/localStorage doesn't have
 * to happen on every log line. To re-evaluate after toggling
 * localStorage, the user must reload — that's intentional, it keeps the
 * gate cheap (and matches DevTools behaviour for similar flags).
 */

let cachedDebug: boolean | null = null;

function compute(): boolean {
  if (typeof window !== "undefined") {
    try {
      const params = new URLSearchParams(window.location.search);
      const url = params.get("debug");
      if (url === "1") return true;
      if (url === "0") return false;
    } catch {
      /* malformed URL — ignore */
    }
    try {
      const ls = window.localStorage?.getItem("app_debug");
      if (ls === "1") return true;
      if (ls === "0") return false;
    } catch {
      /* localStorage unavailable */
    }
  }
  // Default: on in dev, off in production.
  if (typeof process !== "undefined" && process.env?.NODE_ENV !== "production")
    return true;
  return false;
}

export function isDebug(): boolean {
  if (cachedDebug === null) cachedDebug = compute();
  return cachedDebug;
}

/**
 * Force re-evaluation of the debug flag from URL/localStorage. Mostly
 * useful for tests; production code can rely on a one-shot cache.
 */
export function refreshDebugFlag(): void {
  cachedDebug = null;
}

/**
 * Scoped console.debug shortcut. The `scope` shows up as `[mic]`,
 * `[ask-completion]`, `[ptt]`, etc. so the DevTools filter bar can
 * isolate one subsystem.
 *
 * No-ops when debug is off so call sites don't have to gate themselves.
 */
export function dbg(scope: string, ...args: unknown[]): void {
  if (!isDebug()) return;
  // console.debug stays out of the user's way (hidden behind "Verbose"
  // in DevTools by default) but is still capturable via the filter.
  console.debug(`[${scope}]`, ...args);
}

/**
 * Run an async operation with start/end timing in the debug log. Returns
 * the resolved value (or re-throws). Use sparingly — only for spans
 * worth a wall-clock measurement (fetches, WS handshakes).
 */
export async function dbgTime<T>(
  scope: string,
  label: string,
  fn: () => Promise<T>,
): Promise<T> {
  if (!isDebug()) return fn();
  const start = performance.now();
  dbg(scope, `${label} — start`);
  try {
    const result = await fn();
    const elapsed = Math.round(performance.now() - start);
    dbg(scope, `${label} — ok in ${elapsed}ms`);
    return result;
  } catch (err) {
    const elapsed = Math.round(performance.now() - start);
    dbg(scope, `${label} — FAILED in ${elapsed}ms:`, err);
    throw err;
  }
}
