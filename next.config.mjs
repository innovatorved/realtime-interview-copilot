import { DEV_CSP } from "./scripts/csp.mjs";

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
