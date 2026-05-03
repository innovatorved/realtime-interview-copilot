import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import TitleBar from "@/components/TitleBar";
import { AppBackdropProvider } from "@/components/AppBackdropContext";
import { GoogleTagManager } from "@next/third-parties/google";
import { TabProvider } from "@/components/TabContext";
import AppErrorBoundary from "@/components/AppErrorBoundary";
import { PostHogProvider } from "@/components/PostHogProvider";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Realtime Interview Copilot",
  description: "Get Interview Answers Realtime",
  icons: {
    icon: [
      { url: "/icons/favicon-16x16.png", sizes: "16x16", type: "image/png" },
      { url: "/icons/favicon-32x32.png", sizes: "32x32", type: "image/png" },
    ],
  },
};

export const viewport: Viewport = {
  themeColor: "#2f855a",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <head>
        <link rel="icon" href="/icons/favicon.ico" />
        {/*
          Static export ships no HTTP headers, so we also set CSP via meta.
          We drop `unsafe-eval` (not required by Next 16 runtime or analytics),
          keep `unsafe-inline` for scripts only because Next's inline bootstrap
          and GTM require it in a static export, and constrain everything else
          to an explicit allowlist. Edge-level headers in public/_headers
          supersede this meta in production.
        */}
        <meta
          httpEquiv="Content-Security-Policy"
          content="default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; script-src 'self' 'unsafe-inline' https://www.googletagmanager.com https://eu.i.posthog.com https://eu-assets.i.posthog.com; connect-src 'self' http://localhost:8787 https://realtime-worker-api.innovatorved.workers.dev https://realtime-worker-api-prod.vedgupta.in https://*.deepgram.com https://api.deepgram.com https://www.googletagmanager.com https://www.google-analytics.com wss://*.deepgram.com ws://localhost:* ws://127.0.0.1:* https://eu.i.posthog.com https://eu-assets.i.posthog.com; worker-src 'self' blob:; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https://www.googletagmanager.com https://www.google-analytics.com; font-src 'self' data:; media-src 'self' blob:;"
        />
        <meta httpEquiv="X-Content-Type-Options" content="nosniff" />
        <meta name="referrer" content="strict-origin-when-cross-origin" />
      </head>
      <body
        className={`${inter.className} bg-transparent text-white antialiased`}
      >
        <GoogleTagManager gtmId="GTM-TD6DHJZZ" />
        <AppErrorBoundary>
          <PostHogProvider>
            <AppBackdropProvider>
              <TabProvider>
                <TitleBar />
                {children}
              </TabProvider>
            </AppBackdropProvider>
          </PostHogProvider>
        </AppErrorBoundary>
      </body>
    </html>
  );
}
