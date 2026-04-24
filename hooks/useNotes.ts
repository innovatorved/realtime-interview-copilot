"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { BACKEND_API_URL } from "@/lib/constant";
import type { SavedNote, NotesResponse, PaginationInfo } from "@/lib/types";

interface UseNotesOptions {
  initialLimit?: number;
}

export function useNotes({ initialLimit = 10 }: UseNotesOptions = {}) {
  const [notes, setNotes] = useState<SavedNote[]>([]);
  const [pagination, setPagination] = useState<PaginationInfo>({
    page: 1,
    limit: initialLimit,
    total: 0,
    totalPages: 0,
  });
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  // Cancel any in-flight list fetch if the consumer unmounts so we don't
  // setState on a dead component.
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);
  const listFiltersRef = useRef<{ search: string; tag: string }>({
    search: "",
    tag: "",
  });

  const fetchNotes = useCallback(
    async (page = 1, search?: string, tag?: string) => {
      if (search !== undefined) {
        listFiltersRef.current.search = search;
      }
      if (tag !== undefined) {
        listFiltersRef.current.tag = tag;
      }
      const { search: q, tag: t } = listFiltersRef.current;

      abortRef.current?.abort();
      abortRef.current = new AbortController();

      setIsLoading(true);
      setError(null);

      const params = new URLSearchParams({
        page: String(page),
        limit: String(initialLimit),
      });
      if (q) params.set("q", q);
      if (t) params.set("tag", t);

      try {
        const res = await fetch(
          `${BACKEND_API_URL}/api/notes?${params.toString()}`,
          {
            credentials: "include",
            signal: abortRef.current.signal,
          },
        );

        if (!res.ok) throw new Error(`HTTP ${res.status}`);

        const data = (await res.json()) as NotesResponse;
        setNotes(data.notes);
        setPagination(data.pagination);
      } catch (err: unknown) {
        if (err instanceof Error && err.name === "AbortError") return;
        const msg = err instanceof Error ? err.message : String(err);
        setError(msg);
      } finally {
        setIsLoading(false);
      }
    },
    [initialLimit],
  );

  const createNote = useCallback(
    async (content: string, tag: string, title?: string) => {
      setError(null);
      try {
        const res = await fetch(`${BACKEND_API_URL}/api/notes`, {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content, tag, title }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as { note: SavedNote };
        setNotes((prev) => [data.note, ...prev]);
        setPagination((p) => ({ ...p, total: p.total + 1 }));
        return data.note;
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        setError(msg);
        return null;
      }
    },
    [],
  );

  const deleteNote = useCallback(async (noteId: string) => {
    setError(null);
    try {
      const res = await fetch(`${BACKEND_API_URL}/api/notes/${noteId}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setNotes((prev) => prev.filter((n) => n.id !== noteId));
      setPagination((p) => ({ ...p, total: Math.max(0, p.total - 1) }));
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
    }
  }, []);

  return {
    notes,
    pagination,
    isLoading,
    error,
    fetchNotes,
    createNote,
    deleteNote,
  };
}
