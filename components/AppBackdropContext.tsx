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

  useEffect(() => {
    if (typeof document === "undefined") {
      return;
    }
    if (isElectron) {
      document.documentElement.style.setProperty(
        "--app-backdrop-opacity",
        String(backdropOpacity),
      );
    } else {
      document.documentElement.style.removeProperty("--app-backdrop-opacity");
    }
  }, [backdropOpacity, isElectron]);

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

/** Windows transparent windows skip hit-testing on fully transparent pixels. */
const WIN32_MIN_HIT_ALPHA = 0.01;

/**
 * Renders the actual full-window dark fill behind the UI.
 *
 * Lives as a sibling of the routed content (not inside the provider) so
 * that a parent can pass in a `clipToNavbar` flag for compact mode. In
 * compact mode the navbar strip is dimmed only via `titlebar-chrome` and
 * `app-toolbar` (both tied to `--app-backdrop-opacity`). The output area
 * below stays fully transparent — no separate backdrop layer.
 */

export function AppBackdrop({
  clipToNavbar = false,
  navbarHeightPx: _navbarHeightPx = 64,
}: {
  clipToNavbar?: boolean;
  navbarHeightPx?: number;
}) {
  const { backdropOpacity, isElectron } = useAppBackdrop();

  if (clipToNavbar) {
    return null;
  }

  const isWin32 =
    typeof window !== "undefined" &&
    window.electronAPI?.platform === "win32";
  const fillAlpha =
    isWin32 && isElectron
      ? Math.max(backdropOpacity, WIN32_MIN_HIT_ALPHA)
      : backdropOpacity;

  return (
    <div
      aria-hidden
      className="fixed left-0 right-0 top-0 -z-10 pointer-events-auto transition-[background-color,height] duration-200 ease-out"
      style={{
        height: "100%",
        backgroundColor: `rgba(9, 9, 11, ${fillAlpha})`,
      }}
    />
  );
}
