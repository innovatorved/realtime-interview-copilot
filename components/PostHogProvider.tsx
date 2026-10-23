"use client";

import { Suspense, useEffect, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import posthog from "posthog-js";
import { authClient } from "@/lib/auth-client";

const POSTHOG_KEY = process.env.NEXT_PUBLIC_POSTHOG_KEY;
const POSTHOG_HOST = process.env.NEXT_PUBLIC_POSTHOG_HOST;

let initialized = false;

function initPostHog(): boolean {
  if (initialized) return true;
  if (typeof window === "undefined") return false;
  if (!POSTHOG_KEY) {
    if (process.env.NODE_ENV === "development") {
      console.warn(
        "[posthog] NEXT_PUBLIC_POSTHOG_KEY not set — analytics disabled.",
      );
    }
    return false;
  }
  posthog.init(POSTHOG_KEY, {
    api_host: POSTHOG_HOST ?? "https://eu.i.posthog.com",
    person_profiles: "identified_only",
    capture_pageview: false,
    capture_pageleave: true,
    capture_exceptions: true,
    autocapture: true,
    persistence: "localStorage+cookie",
    loaded: (ph) => {
      if (process.env.NODE_ENV === "development") ph.debug();
    },
  });
  initialized = true;
  return true;
}

function PostHogPageviewTracker({ ready }: { ready: boolean }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  useEffect(() => {
    if (!ready || !pathname) return;
    const qs = searchParams?.toString() ?? "";
    const url = qs.length > 0 ? `${pathname}?${qs}` : pathname;
    posthog.capture("$pageview", {
      $current_url:
        typeof window !== "undefined" ? window.location.origin + url : url,
      pathname,
    });
  }, [ready, pathname, searchParams]);

  return null;
}

function PostHogIdentifyOnSession({ ready }: { ready: boolean }) {
  const { data: session } = authClient.useSession();

  useEffect(() => {
    if (!ready) return;
    const u = session?.user as
      | { id?: string; email?: string; name?: string }
      | undefined;
    if (!u?.email) return;
    posthog.identify(u.email, {
      email: u.email,
      name: u.name,
      user_id: u.id,
    });
  }, [ready, session]);

  return null;
}

/**
 * Tag every captured event/exception with the packaged app version so
 * error triage can distinguish releases. Global error + unhandledrejection
 * capture is already enabled via `capture_exceptions` in posthog.init.
 */
function PostHogAppVersionTagger({ ready }: { ready: boolean }) {
  useEffect(() => {
    if (!ready || typeof window === "undefined") return;
    window.electronAPI
      ?.updaterGetVersion?.()
      .then((version) => {
        if (version) posthog.register({ app_version: version });
      })
      .catch(() => {
        /* browser / older preload without updater IPC */
      });
  }, [ready]);
  return null;
}

export function PostHogProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(initialized);

  useEffect(() => {
    if (initPostHog()) {
      setReady(true);
    }
  }, []);

  return (
    <>
      <Suspense fallback={null}>
        <PostHogPageviewTracker ready={ready} />
      </Suspense>
      <PostHogIdentifyOnSession ready={ready} />
      <PostHogAppVersionTagger ready={ready} />
      {children}
    </>
  );
}
