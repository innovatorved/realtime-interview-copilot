"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { BACKEND_API_URL } from "@/lib/constant";
import { ricFetch } from "@/lib/ric-fetch";
import type { InterviewPreset } from "@/lib/types";

export interface PresetContextFields {
  resumeText?: string | null;
  resumeFileName?: string | null;
  jobDescription?: string | null;
}

export function usePresets() {
  const [presets, setPresets] = useState<InterviewPreset[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  const fetchPresets = useCallback(async () => {
    abortRef.current?.abort();
    abortRef.current = new AbortController();
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch(`${BACKEND_API_URL}/api/presets`, {
        credentials: "include",
        signal: abortRef.current.signal,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { presets: InterviewPreset[] };
      setPresets(data.presets);
    } catch (err: unknown) {
      if (err instanceof Error && err.name === "AbortError") return;
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const updatePresetContext = useCallback(
    async (presetId: string, fields: PresetContextFields): Promise<boolean> => {
      setError(null);
      try {
        const res = await ricFetch(
          `/api/presets/${encodeURIComponent(presetId)}/context`,
          {
            method: "PATCH",
            body: JSON.stringify(fields),
          },
        );
        if (!res.ok) {
          let msg = `HTTP ${res.status}`;
          try {
            const data = (await res.json()) as { error?: string };
            if (data?.error) msg = data.error;
          } catch {
            /* ignore */
          }
          throw new Error(msg);
        }
        await fetchPresets();
        return true;
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        setError(msg);
        return false;
      }
    },
    [fetchPresets],
  );

  return { presets, isLoading, error, fetchPresets, updatePresetContext };
}
