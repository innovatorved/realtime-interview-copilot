"use client";

import { Suspense, useEffect } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import posthog from "posthog-js";
import { authClient } from "@/lib/auth-client";

const POSTHOG_KEY = process.env.NEXT_PUBLIC_POSTHOG_KEY;
const POSTHOG_HOST = process.env.NEXT_PUBLIC_POSTHOG_HOST;

let initialized = false;

function initPostHog() {
  if (initialized || typeof window === "undefined") return;
  if (!POSTHOG_KEY) {
    if (process.env.NODE_ENV === "development") {
      console.warn(
        "[posthog] NEXT_PUBLIC_POSTHOG_KEY not set — analytics disabled.",
      );
    }
    return;
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
}

function PostHogPageviewTracker() {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  useEffect(() => {
    if (!initialized || !pathname) return;
    const qs = searchParams?.toString() ?? "";
    const url = qs.length > 0 ? `${pathname}?${qs}` : pathname;
    posthog.capture("$pageview", {
      $current_url: typeof window !== "undefined" ? window.location.origin + url : url,
      pathname,
    });
  }, [pathname, searchParams]);

  return null;
}

function PostHogIdentifyOnSession() {
  const { data: session } = authClient.useSession();

  useEffect(() => {
    if (!initialized) return;
    const u = session?.user as
      | { id?: string; email?: string; name?: string }
      | undefined;
    if (!u?.email) return;
    posthog.identify(u.email, {
      email: u.email,
      name: u.name,
      user_id: u.id,
    });
  }, [session]);

  return null;
}

export function PostHogProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    initPostHog();
  }, []);

  return (
    <>
      <Suspense fallback={null}>
        <PostHogPageviewTracker />
      </Suspense>
      <PostHogIdentifyOnSession />
      {children}
    </>
  );
}
