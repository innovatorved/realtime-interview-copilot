const isDev = process.env.NODE_ENV === "development";

// Dev-only CSP served by `next dev`. Notes:
//   - Includes `'unsafe-eval'` because React's dev runtime uses
//     `eval()` for callstack reconstruction (without it, React logs
//     "eval() is not supported in this environment" on every load).
//   - Uses the `https://*.i.posthog.com` wildcard so EU + US PostHog
//     hosts both work without listing each subdomain.
//   - Allows `ws://localhost:* ws://127.0.0.1:*` so HMR websockets
//     connect when the renderer is opened in a regular browser tab
//     (Electron has its own dev CSP in electron/main.ts that wins on
//     the Electron renderer, but keeping this aligned avoids
//     surprises when debugging via Chromium directly).
//   - When the page loads inside Electron, this header is stripped
//     by `webRequest.onHeadersReceived` and replaced with the
//     Electron-specific dev CSP, so changes here don't affect the
//     packaged app.
const DEV_CSP =
  "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; script-src 'self' 'unsafe-eval' 'unsafe-inline' https://*.i.posthog.com https://www.googletagmanager.com; connect-src 'self' http://localhost:8787 https://*.i.posthog.com https://realtime-worker-api.innovatorved.workers.dev https://realtime-worker-api-prod.vedgupta.in https://*.deepgram.com https://api.deepgram.com https://www.googletagmanager.com https://www.google-analytics.com https://analytics.google.com https://www.google.com https://region1.google-analytics.com wss://*.deepgram.com ws://localhost:* ws://127.0.0.1:*; worker-src 'self' blob:; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https://*.i.posthog.com https://www.googletagmanager.com https://www.google-analytics.com; font-src 'self' data:; media-src 'self' blob:;";

const devSecurityHeaders = [
  {
    source: "/(.*)",
    headers: [
      {
        key: "X-Content-Type-Options",
        value: "nosniff",
      },
      {
        key: "X-Frame-Options",
        value: "DENY",
      },
      {
        key: "Referrer-Policy",
        value: "strict-origin-when-cross-origin",
      },
      {
        key: "Content-Security-Policy",
        value: DEV_CSP,
      },
    ],
  },
  {
    source: "/sw.js",
    headers: [
      {
        key: "Content-Type",
        value: "application/javascript; charset=utf-8",
      },
      {
        key: "Cache-Control",
        value: "no-cache, no-store, must-revalidate",
      },
      {
        key: "Content-Security-Policy",
        value: DEV_CSP,
      },
    ],
  },
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "export",
  assetPrefix: isDev ? undefined : "./",
  images: {
    unoptimized: true,
  },
  ...(isDev
    ? {
        async headers() {
          return devSecurityHeaders;
        },
      }
    : {}),
};

export default nextConfig;
