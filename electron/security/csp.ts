import type { Session } from "electron";

/** Content-Security-Policy strings + wiring.
 *
 *  Dev needs HMR websockets and `unsafe-eval` for Next.js fast refresh;
 *  packaged builds drop those so a renderer compromise cannot execute
 *  eval-built code or reach arbitrary ws:// endpoints.
 *
 *  PostHog notes:
 *   - PostHog lazy-loads its sub-feature scripts (recorder, web-vitals,
 *     surveys, dead-clicks, exception-autocapture) by injecting <script>
 *     tags pointing at `eu-assets.i.posthog.com/static/*`. Those need
 *     `script-src`, NOT just `connect-src` — that's why the previous CSP
 *     blocked all of them with `failed to load script [object Event]`.
 *   - We use the wildcard `https://*.i.posthog.com` everywhere it's
 *     referenced so a US-region fallback (`us.i.posthog.com` /
 *     `us-assets.i.posthog.com`) still works without further edits.
 *     This matches PostHog's own published CSP guidance. */
const DEV_CSP =
  "default-src 'self'; connect-src 'self' http://localhost:8787 https://*.i.posthog.com https://copilot.vedgupta.in https://realtime-worker-api.innovatorved.workers.dev https://realtime-worker-api-prod.vedgupta.in https://*.deepgram.com https://api.deepgram.com https://www.googletagmanager.com https://www.google-analytics.com https://analytics.google.com https://www.google.com https://region1.google-analytics.com wss://*.deepgram.com ws://localhost:* ws://127.0.0.1:*; script-src 'self' 'unsafe-eval' 'unsafe-inline' https://*.i.posthog.com https://www.googletagmanager.com; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https://*.i.posthog.com https://www.googletagmanager.com https://www.google-analytics.com; font-src 'self' data:; media-src 'self' blob:; worker-src 'self' blob:; object-src 'none'; base-uri 'self'; frame-ancestors 'none';";

const PROD_CSP =
  "default-src 'self'; connect-src 'self' https://*.i.posthog.com https://copilot.vedgupta.in https://realtime-worker-api.innovatorved.workers.dev https://realtime-worker-api-prod.vedgupta.in https://*.deepgram.com https://api.deepgram.com https://www.googletagmanager.com https://www.google-analytics.com https://analytics.google.com https://www.google.com https://region1.google-analytics.com wss://*.deepgram.com; script-src 'self' 'unsafe-inline' https://*.i.posthog.com https://www.googletagmanager.com; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https://*.i.posthog.com https://www.googletagmanager.com https://www.google-analytics.com; font-src 'self' data:; media-src 'self' blob:; worker-src 'self' blob:; object-src 'none'; base-uri 'self'; frame-ancestors 'none';";

export function pickCsp(isPackaged: boolean): string {
  return isPackaged ? PROD_CSP : DEV_CSP;
}

/** Install the CSP injector on a session. Strips any upstream
 *  Content-Security-Policy / CSP-Report-Only headers (case-insensitive)
 *  before injecting Electron's own.
 *
 *  Next's dev server (next.config.mjs `headers()`) emits a lower-case
 *  `content-security-policy` header that would otherwise survive — and
 *  because browsers intersect multiple CSP sources, that upstream header
 *  silently strips `'unsafe-eval'` from the effective policy, producing
 *  the React dev-mode "eval() is not supported … include unsafe-eval"
 *  warning. Stripping first guarantees Electron's CSP is the SOLE policy
 *  on the response. */
export function installCsp(s: Session, csp: string): void {
  s.webRequest.onHeadersReceived((details, callback) => {
    const sourceHeaders = details.responseHeaders ?? {};
    const filteredHeaders: Record<string, string[] | string> = {};
    for (const [name, value] of Object.entries(sourceHeaders)) {
      if (/^content-security-policy(-report-only)?$/i.test(name)) continue;
      filteredHeaders[name] = value as string[] | string;
    }
    filteredHeaders["Content-Security-Policy"] = [csp];
    callback({ responseHeaders: filteredHeaders });
  });
}

/** Inject Origin header for API requests to fix "Missing or null Origin"
 *  errors. This is required because Electron sends "file://" or "null"
 *  as origin for local files. */
export function installOriginHeaderInjection(s: Session): void {
  s.webRequest.onBeforeSendHeaders(
    {
      urls: [
        "https://realtime-worker-api.innovatorved.workers.dev/*",
        "https://realtime-worker-api-prod.vedgupta.in/*",
        "https://*.deepgram.com/*",
        "https://api.deepgram.com/*",
      ],
    },
    (details, callback) => {
      // Mimic development origin which is likely whitelisted server-side.
      details.requestHeaders["Origin"] = "http://localhost:3000";
      callback({ requestHeaders: details.requestHeaders });
    },
  );
}
