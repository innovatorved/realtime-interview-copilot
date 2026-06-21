const DEV_CSP =
  "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; script-src 'self' 'unsafe-eval' 'unsafe-inline' https://*.i.posthog.com https://www.googletagmanager.com; connect-src 'self' http://localhost:8787 https://*.i.posthog.com https://realtime-worker-api.innovatorved.workers.dev https://realtime-worker-api-prod.vedgupta.in https://*.deepgram.com https://api.deepgram.com https://www.googletagmanager.com https://www.google-analytics.com https://analytics.google.com https://www.google.com https://region1.google-analytics.com https://stats.g.doubleclick.net https://*.doubleclick.net wss://*.deepgram.com ws://localhost:* ws://127.0.0.1:*; worker-src 'self' blob:; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https://*.i.posthog.com https://www.googletagmanager.com https://www.google-analytics.com https://analytics.google.com https://www.google.com https://www.google.co.in https://region1.google-analytics.com https://stats.g.doubleclick.net https://*.doubleclick.net; font-src 'self' data:; media-src 'self' blob:;";

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
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "export",
  assetPrefix: process.env.NODE_ENV === "development" ? undefined : "./",
  images: {
    unoptimized: true,
  },
  ...(process.env.NODE_ENV === "development"
    ? {
        async headers() {
          return devSecurityHeaders;
        },
      }
    : {}),
};

export default nextConfig;
