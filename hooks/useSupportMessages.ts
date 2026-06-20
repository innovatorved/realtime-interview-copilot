"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { BACKEND_API_URL } from "@/lib/constant";
import { ricFetch } from "@/lib/ric-fetch";
import type {
  SupportMessage,
  SupportThreadListResponse,
  SupportThreadResponse,
} from "@/lib/types";

interface UseSupportMessagesOptions {
  pollMs?: number;
  enabled?: boolean;
}

interface SendOptions {
  body: string;
  subject?: string;
  parentId?: string;
}

interface UseSupportMessagesReturn {
  threads: SupportMessage[];
  total: number;
  isLoading: boolean;
  error: string | null;
  hasUnread: boolean;
  refresh: () => Promise<void>;
  send: (opts: SendOptions) => Promise<SupportMessage | null>;
  fetchThread: (threadId: string) => Promise<SupportThreadResponse | null>;
  markThreadRead: (threadId: string) => Promise<boolean>;
}

/**
 * Hook used by both the WaitingForApproval card and the main app to
 * fetch, send, and poll support messages. Pending users use this
 * exclusively to talk to admins; approved users can use it for
 * support requests too.
 */
export function useSupportMessages(
  opts: UseSupportMessagesOptions = {},
): UseSupportMessagesReturn {
  const { pollMs = 30_000, enabled = true } = opts;
  const [threads, setThreads] = useState<SupportMessage[]>([]);
  const [total, setTotal] = useState(0);
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
      const res = await fetch(`${BACKEND_API_URL}/api/support/messages`, {
        credentials: "include",
        signal: abortRef.current.signal,
      });
      if (res.status === 401 || res.status === 403) {
        setThreads([]);
        setTotal(0);
        return;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as SupportThreadListResponse;
      setThreads(data.threads ?? []);
      setTotal(data.total ?? 0);
    } catch (err: unknown) {
      if (err instanceof Error && err.name === "AbortError") return;
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
    } finally {
      setIsLoading(false);
    }
  }, [enabled]);

  const send = useCallback(async ({ body, subject, parentId }: SendOptions) => {
    setError(null);
    try {
      const res = await ricFetch("/api/support/messages", {
        method: "POST",
        body: JSON.stringify({ body, subject, parentId }),
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
      const data = (await res.json()) as { message: SupportMessage };
      if (!parentId) {
        // New thread: prepend optimistically.
        setThreads((prev) => [data.message, ...prev]);
        setTotal((t) => t + 1);
      }
      return data.message;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      return null;
    }
  }, []);

  const fetchThread = useCallback(async (threadId: string) => {
    try {
      const res = await fetch(
        `${BACKEND_API_URL}/api/support/messages?threadId=${encodeURIComponent(threadId)}`,
        { credentials: "include" },
      );
      if (!res.ok) return null;
      return (await res.json()) as SupportThreadResponse;
    } catch {
      return null;
    }
  }, []);

  const markThreadRead = useCallback(async (threadId: string) => {
    try {
      const res = await ricFetch("/api/support/messages/read", {
        method: "POST",
        body: JSON.stringify({ threadId }),
      });
      if (!res.ok) return false;
      setThreads((prev) =>
        prev.map((t) =>
          t.id === threadId ? { ...t, unreadByUser: false } : t,
        ),
      );
      return true;
    } catch {
      return false;
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
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  const hasUnread = threads.some((t) => t.unreadByUser);

  return {
    threads,
    total,
    isLoading,
    error,
    hasUnread,
    refresh,
    send,
    fetchThread,
    markThreadRead,
  };
}
