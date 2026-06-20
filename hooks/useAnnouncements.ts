"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { BACKEND_API_URL } from "@/lib/constant";
import { ricFetch } from "@/lib/ric-fetch";
import type { ActiveAnnouncementsResponse, AppAnnouncement } from "@/lib/types";

const SESSION_DISMISSED_BANNERS_KEY = "interview-copilot-banner-dismissed";

interface UseAnnouncementsOptions {
  pollMs?: number;
  enabled?: boolean;
}

interface UseAnnouncementsReturn {
  banners: AppAnnouncement[];
  popups: AppAnnouncement[];
  toasts: AppAnnouncement[];
  isLoading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  /** Persistent dismiss (popups). Hits the backend. */
  dismiss: (id: string) => Promise<void>;
  /** Banner: ephemeral, only stored in localStorage for this session. */
  dismissBannerLocal: (id: string) => void;
  /** Acknowledge for analytics without dismissing. */
  ack: (id: string) => Promise<void>;
}

function readDismissedBanners(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = window.localStorage.getItem(SESSION_DISMISSED_BANNERS_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return new Set(parsed);
    return new Set();
  } catch {
    return new Set();
  }
}

function persistDismissedBanners(set: Set<string>) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      SESSION_DISMISSED_BANNERS_KEY,
      JSON.stringify([...set]),
    );
  } catch {
    /* ignore */
  }
}

/**
 * Fetches active announcements for the current user and exposes them
 * split by kind. Banners are session-dismissable in the browser only;
 * popups persist their dismissal server-side so they don't reappear on
 * the next launch.
 */
export function useAnnouncements(
  opts: UseAnnouncementsOptions = {},
): UseAnnouncementsReturn {
  const { pollMs = 60_000, enabled = true } = opts;
  const [items, setItems] = useState<AppAnnouncement[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [localBanners, setLocalBanners] = useState<Set<string>>(new Set());
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    setLocalBanners(readDismissedBanners());
  }, []);

  const refresh = useCallback(async () => {
    if (!enabled) return;
    abortRef.current?.abort();
    abortRef.current = new AbortController();
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch(`${BACKEND_API_URL}/api/announcements/active`, {
        credentials: "include",
        signal: abortRef.current.signal,
      });
      if (res.status === 401 || res.status === 403) {
        setItems([]);
        return;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as ActiveAnnouncementsResponse;
      setItems(data.announcements ?? []);
    } catch (err: unknown) {
      if (err instanceof Error && err.name === "AbortError") return;
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
    } finally {
      setIsLoading(false);
    }
  }, [enabled]);

  const dismiss = useCallback(async (id: string) => {
    setItems((prev) => prev.filter((a) => a.id !== id));
    try {
      await ricFetch(`/api/announcements/${encodeURIComponent(id)}/dismiss`, {
        method: "POST",
      });
    } catch {
      /* swallow — UI is already updated */
    }
  }, []);

  const dismissBannerLocal = useCallback((id: string) => {
    setLocalBanners((prev) => {
      const next = new Set(prev);
      next.add(id);
      persistDismissedBanners(next);
      return next;
    });
  }, []);

  const ack = useCallback(async (id: string) => {
    try {
      await ricFetch(`/api/announcements/${encodeURIComponent(id)}/ack`, {
        method: "POST",
      });
    } catch {
      /* analytics call — never fail */
    }
  }, []);

  useEffect(() => {
    void refresh();
    if (!enabled || pollMs <= 0) return;
    const id = window.setInterval(() => {
      void refresh();
    }, pollMs);
    return () => window.clearInterval(id);
  }, [refresh, pollMs, enabled]);

  useEffect(() => {
    return () => abortRef.current?.abort();
  }, []);

  const banners = items.filter(
    (a) => a.kind === "banner" && !localBanners.has(a.id),
  );
  const popups = items.filter((a) => a.kind === "popup");
  const toasts = items.filter((a) => a.kind === "toast");

  return {
    banners,
    popups,
    toasts,
    isLoading,
    error,
    refresh,
    dismiss,
    dismissBannerLocal,
    ack,
  };
}
