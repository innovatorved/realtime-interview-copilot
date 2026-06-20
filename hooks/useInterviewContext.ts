"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { BACKEND_API_URL } from "@/lib/constant";
import { ricFetch } from "@/lib/ric-fetch";
import type { UserInterviewContext } from "@/lib/types";

export interface InterviewContextFields {
  interviewNotes?: string | null;
  resumeText?: string | null;
  resumeFileName?: string | null;
  jobDescription?: string | null;
}

const EMPTY: UserInterviewContext = {
  interviewNotes: null,
  resumeText: null,
  resumeFileName: null,
  jobDescription: null,
  updatedAt: null,
};

export function useInterviewContext() {
  const [context, setContext] = useState<UserInterviewContext>(EMPTY);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  const fetchContext = useCallback(async () => {
    abortRef.current?.abort();
    abortRef.current = new AbortController();
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch(`${BACKEND_API_URL}/api/interview-context`, {
        credentials: "include",
        signal: abortRef.current.signal,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { context: UserInterviewContext };
      setContext(data.context ?? EMPTY);
    } catch (err: unknown) {
      if (err instanceof Error && err.name === "AbortError") return;
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const updateContext = useCallback(
    async (fields: InterviewContextFields): Promise<boolean> => {
      setIsSaving(true);
      setError(null);
      try {
        const res = await ricFetch("/api/interview-context", {
          method: "PATCH",
          body: JSON.stringify(fields),
        });
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
        const data = (await res.json()) as { context: UserInterviewContext };
        if (data.context) setContext(data.context);
        else await fetchContext();
        return true;
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        setError(msg);
        return false;
      } finally {
        setIsSaving(false);
      }
    },
    [fetchContext],
  );

  return {
    context,
    setContext,
    isLoading,
    isSaving,
    error,
    fetchContext,
    updateContext,
  };
}
