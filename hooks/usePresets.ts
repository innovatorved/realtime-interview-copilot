"use client";

import { useState, useCallback } from "react";
import { BACKEND_API_URL } from "@/lib/constant";
import type { InterviewPreset } from "@/lib/types";

export function usePresets() {
  const [presets, setPresets] = useState<InterviewPreset[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchPresets = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch(`${BACKEND_API_URL}/api/presets`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { presets: InterviewPreset[] };
      setPresets(data.presets);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
    } finally {
      setIsLoading(false);
    }
  }, []);

  return { presets, isLoading, error, fetchPresets };
}
