import type { Metadata, Viewport } from "next";
import "./globals.css";
import TitleBar from "@/components/TitleBar";
import { AppBackdropProvider } from "@/components/AppBackdropContext";
import { GoogleTagManager } from "@next/third-parties/google";
import { TabProvider } from "@/components/TabContext";
import { TranscriptionProvider } from "@/components/TranscriptionContext";
import { InterviewContextProvider } from "@/components/InterviewContextProvider";
import { CopilotSessionProvider } from "@/components/CopilotSessionProvider";
import { AskChatProvider } from "@/components/AskChatProvider";
import AppErrorBoundary from "@/components/AppErrorBoundary";
import { PostHogProvider } from "@/components/PostHogProvider";
import constants from "@/constant.json";

export const metadata: Metadata = {
  title: constants.displayName,
  description: "Get Interview Answers Realtime",
  icons: {
    icon: [
      { url: "/icons/favicon-16x16.png", sizes: "16x16", type: "image/png" },
      { url: "/icons/favicon-32x32.png", sizes: "32x32", type: "image/png" },
    ],
  },
};

export const viewport: Viewport = {
  themeColor: "#1c1917",
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
          Static export ships no HTTP headers, so we set CSP via meta —
          but ONLY in production builds. React's dev runtime needs
          `eval()` for callstack reconstruction, which would force this
          meta to include `'unsafe-eval'`. We don't want that weakening
          our prod policy, and we don't need the meta in dev at all
          because Electron's renderer session already sets a dev CSP
          via HTTP header (electron/main.ts) that DOES allow
          `'unsafe-eval'`. Browsers enforce the intersection of all CSP
          sources, so a missing-in-meta directive silently overrides
          the more permissive header — which was the source of the
          "eval() is not supported … unsafe-eval … included" warning.

          The Electron dev header CSP, this meta, and public/_headers
          must stay in lockstep — any directive missing from one layer
          is effectively blocked across all of them.

          PostHog hosts use the `https://*.i.posthog.com` wildcard so EU
          (eu.i / eu-assets.i) and the US fallback (us.i / us-assets.i)
          both work without further edits. PostHog injects its sub-feature
          scripts (recorder, web-vitals, surveys, dead-clicks, exception
          autocapture) at runtime, so they need `script-src` — not just
          `connect-src`. They also load assets via `img-src`.
        */}
        {process.env.NODE_ENV === "production" && (
          <meta
            httpEquiv="Content-Security-Policy"
            content="default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; script-src 'self' 'unsafe-inline' https://*.i.posthog.com https://www.googletagmanager.com; connect-src 'self' http://localhost:8787 https://*.i.posthog.com https://realtime-worker-api.innovatorved.workers.dev https://realtime-worker-api-prod.vedgupta.in https://*.deepgram.com https://api.deepgram.com https://www.googletagmanager.com https://www.google-analytics.com https://analytics.google.com https://www.google.com https://region1.google-analytics.com wss://*.deepgram.com ws://localhost:* ws://127.0.0.1:*; worker-src 'self' blob:; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https://*.i.posthog.com https://www.googletagmanager.com https://www.google-analytics.com https://analytics.google.com https://www.google.com https://www.google.co.in https://region1.google-analytics.com; font-src 'self' data:; media-src 'self' blob:;"
          />
        )}
        <meta httpEquiv="X-Content-Type-Options" content="nosniff" />
        <meta name="referrer" content="strict-origin-when-cross-origin" />
      </head>
      <body className="font-sans bg-transparent text-text-primary antialiased">
        <GoogleTagManager gtmId="GTM-TD6DHJZZ" />
        <AppErrorBoundary>
          <PostHogProvider>
            <AppBackdropProvider>
              <TabProvider>
                <TranscriptionProvider>
                  <InterviewContextProvider>
                    <CopilotSessionProvider>
                      <AskChatProvider>
                        <TitleBar />
                        {children}
                      </AskChatProvider>
                    </CopilotSessionProvider>
                  </InterviewContextProvider>
                </TranscriptionProvider>
              </TabProvider>
            </AppBackdropProvider>
          </PostHogProvider>
        </AppErrorBoundary>
      </body>
    </html>
  );
}
