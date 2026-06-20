"use client";

import {
  createContext,
  useContext,
  useState,
  useEffect,
  ReactNode,
} from "react";

export type TabType = "copilot" | "ask-ai" | "notes";

const COMPACT_MODE_STORAGE_KEY = "interview-copilot-compact-mode";

interface TabContextType {
  activeTab: TabType;
  setActiveTab: (tab: TabType) => void;
  compactMode: boolean;
  setCompactMode: (value: boolean) => void;
}

const TabContext = createContext<TabContextType | undefined>(undefined);

export function TabProvider({ children }: { children: ReactNode }) {
  const [activeTab, setActiveTab] = useState<TabType>("copilot");
  const [compactMode, setCompactModeState] = useState<boolean>(false);

  // Hydrate compact mode preference from localStorage on mount.
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const stored = window.localStorage.getItem(COMPACT_MODE_STORAGE_KEY);
      if (stored === "1") setCompactModeState(true);
    } catch {
      /* localStorage unavailable */
    }
  }, []);

  const setCompactMode = (value: boolean) => {
    setCompactModeState(value);
    try {
      if (typeof window !== "undefined") {
        window.localStorage.setItem(
          COMPACT_MODE_STORAGE_KEY,
          value ? "1" : "0",
        );
      }
    } catch {
      /* localStorage unavailable */
    }
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (compactMode) return;

      if (e.altKey && e.code === "KeyC") {
        e.preventDefault();
        setActiveTab("copilot");
      }
      if (e.altKey && e.code === "KeyA") {
        e.preventDefault();
        setActiveTab("ask-ai");
      }
      if (e.altKey && e.code === "KeyN") {
        e.preventDefault();
        setActiveTab("notes");
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [compactMode]);

  return (
    <TabContext.Provider
      value={{ activeTab, setActiveTab, compactMode, setCompactMode }}
    >
      {children}
    </TabContext.Provider>
  );
}

export function useTab() {
  const context = useContext(TabContext);
  if (context === undefined) {
    throw new Error("useTab must be used within a TabProvider");
  }
  return context;
}
