"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

const STORAGE_KEY = "copilot-backdrop-opacity";

function clampBackdropOpacity(value: number): number {
  if (Number.isNaN(value)) {
    return 1;
  }
  return Math.max(0, Math.min(1, value));
}

type AppBackdropContextValue = {
  /** Opacity of the window fill behind the UI (1 = solid, lower = more desktop visible). */
  backdropOpacity: number;
  setBackdropOpacity: (value: number) => void;
  adjustBackdropOpacity: (delta: number) => void;
  isElectron: boolean;
};

const AppBackdropContext = createContext<AppBackdropContextValue | null>(null);

export function useAppBackdrop() {
  const ctx = useContext(AppBackdropContext);
  if (!ctx) {
    throw new Error("useAppBackdrop must be used within AppBackdropProvider");
  }
  return ctx;
}

export function AppBackdropProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [backdropOpacity, setBackdropOpacityState] = useState(1);
  const [isElectron, setIsElectron] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const electron = Boolean(window.electronAPI);
    setIsElectron(electron);
    if (electron) {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw !== null) {
        setBackdropOpacityState(clampBackdropOpacity(Number.parseFloat(raw)));
      }
    }
  }, []);

  const persistIfElectron = useCallback((next: number) => {
    if (typeof window !== "undefined" && window.electronAPI) {
      window.localStorage.setItem(STORAGE_KEY, String(next));
    }
  }, []);

  const setBackdropOpacity = useCallback(
    (value: number) => {
      const next = clampBackdropOpacity(value);
      setBackdropOpacityState(next);
      persistIfElectron(next);
    },
    [persistIfElectron],
  );

  const adjustBackdropOpacity = useCallback(
    (delta: number) => {
      setBackdropOpacityState((prev) => {
        const next = clampBackdropOpacity(prev + delta);
        persistIfElectron(next);
        return next;
      });
    },
    [persistIfElectron],
  );

  const value = useMemo(
    () => ({
      backdropOpacity,
      setBackdropOpacity,
      adjustBackdropOpacity,
      isElectron,
    }),
    [backdropOpacity, setBackdropOpacity, adjustBackdropOpacity, isElectron],
  );

  return (
    <AppBackdropContext.Provider value={value}>
      {children}
    </AppBackdropContext.Provider>
  );
}

/**
 * Renders the actual full-window dark fill behind the UI.
 *
 * Lives as a sibling of the routed content (not inside the provider) so
 * that a parent can pass in a `clipToNavbar` flag for compact mode. In
 * compact mode we limit the backdrop to a thin strip behind the toolbar
 * — everything below that becomes truly transparent so the answer text
 * floats over the desktop with no dark sheet visible at all.
 */
export function AppBackdrop({
  clipToNavbar = false,
  navbarHeightPx = 64,
}: {
  clipToNavbar?: boolean;
  navbarHeightPx?: number;
}) {
  const { backdropOpacity } = useAppBackdrop();
  return (
    <div
      aria-hidden
      className="fixed left-0 right-0 top-0 -z-10 pointer-events-none transition-[background-color,height] duration-200 ease-out"
      style={{
        height: clipToNavbar ? `${navbarHeightPx}px` : "100%",
        backgroundColor: `rgba(9, 9, 11, ${backdropOpacity})`,
      }}
    />
  );
}
