"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { BACKEND_API_URL } from "@/lib/constant";

export interface QuotaSummary {
  planTier: string;
  monthlyAllowanceSeconds: number | null;
  monthlyAllowanceCompletions: number | null;
  consumedSeconds: number;
  consumedCompletions: number;
  remainingSeconds: number | null;
  remainingCompletions: number | null;
  cycleResetAt: string;
  overageAllowed: boolean;
  enforcementEnabled: boolean;
  recordConsumption: boolean;
}

export interface UsageMeResponse {
  window: string;
  since: string;
  bucketSeconds: number;
  totals: Record<string, number>;
  perAction: Record<string, number>;
  timeseries: Array<{ bucket: string; count: number }>;
  quota: QuotaSummary;
}

interface UseUsageMeOptions {
  pollMs?: number;
  enabled?: boolean;
  window?: "24h" | "7d" | "30d" | "90d";
}

export function useUsageMe(options: UseUsageMeOptions = {}) {
  const { pollMs = 60_000, enabled = true, window: usageWindow = "30d" } =
    options;
  const [data, setData] = useState<UsageMeResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const refresh = useCallback(async () => {
    if (!enabled) return;
    abortRef.current?.abort();
    abortRef.current = new AbortController();
    setIsLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ window: usageWindow });
      const res = await fetch(
        `${BACKEND_API_URL}/api/usage/me?${params.toString()}`,
        {
          credentials: "include",
          signal: abortRef.current.signal,
        },
      );
      if (res.status === 401 || res.status === 403) {
        setData(null);
        return;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setData((await res.json()) as UsageMeResponse);
    } catch (err: unknown) {
      if (err instanceof Error && err.name === "AbortError") return;
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
    } finally {
      setIsLoading(false);
    }
  }, [enabled, usageWindow]);

  useEffect(() => {
    void refresh();
    if (!enabled || pollMs <= 0) return;
    const id = window.setInterval(() => {
      void refresh();
    }, pollMs);
    return () => window.clearInterval(id);
  }, [refresh, pollMs, enabled]);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  return { data, isLoading, error, refresh };
}
