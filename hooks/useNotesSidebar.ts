"use client";

/** Persisted-open state for the notes sidebar on the main shell.
 *
 *  Reads the saved preference on mount (defaults to open) and writes
 *  back to localStorage whenever the caller toggles via the returned
 *  `setOpenPersisted`. */

import { useCallback, useEffect, useState } from "react";

const NOTES_SIDEBAR_STORAGE_KEY = "interview-copilot-notes-sidebar-open";

export interface NotesSidebarHandle {
  open: boolean;
  setOpenPersisted: (open: boolean) => void;
  toggle: () => void;
}

export function useNotesSidebar(): NotesSidebarHandle {
  const [open, setOpen] = useState(true);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const stored = localStorage.getItem(NOTES_SIDEBAR_STORAGE_KEY);
      if (stored === "0") {
        setOpen(false);
      }
    } catch {
      /* ignore */
    }
  }, []);

  const setOpenPersisted = useCallback((next: boolean) => {
    setOpen(next);
    try {
      localStorage.setItem(NOTES_SIDEBAR_STORAGE_KEY, next ? "1" : "0");
    } catch {
      /* ignore */
    }
  }, []);

  const toggle = useCallback(() => {
    setOpen((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(NOTES_SIDEBAR_STORAGE_KEY, next ? "1" : "0");
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  return { open, setOpenPersisted, toggle };
}
