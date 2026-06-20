"use client";

/**
 * Shared Copilot/Summarizer output and mode flag for full + compact surfaces.
 * Persisted to sessionStorage so reloads and mode switches stay in sync.
 */

import {
  createContext,
  useContext,
  useEffect,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react";
import {
  APP_SESSION_KEYS,
  migrateLegacySessionKeys,
  readAppSession,
  writeAppSession,
} from "@/lib/app-session-storage";
import { FLAGS } from "@/lib/types";
import type { CompactOutputMode } from "@/components/compact/OutputPanel";

type CopilotSessionValue = {
  completion: string;
  setCompletion: Dispatch<SetStateAction<string>>;
  flag: FLAGS;
  setFlag: Dispatch<SetStateAction<FLAGS>>;
  outputMode: CompactOutputMode;
  setOutputMode: Dispatch<SetStateAction<CompactOutputMode>>;
};

const CopilotSessionContext = createContext<CopilotSessionValue | null>(null);

function readFlag(): FLAGS {
  const stored = readAppSession(APP_SESSION_KEYS.flag);
  return stored === FLAGS.SUMMARIZER ? FLAGS.SUMMARIZER : FLAGS.COPILOT;
}

function readOutputMode(): CompactOutputMode {
  const stored = readAppSession(APP_SESSION_KEYS.outputMode);
  return stored === "chat" ? "chat" : "transcript";
}

export function CopilotSessionProvider({ children }: { children: ReactNode }) {
  const [completion, setCompletion] = useState("");
  const [flag, setFlag] = useState<FLAGS>(FLAGS.COPILOT);
  const [outputMode, setOutputMode] = useState<CompactOutputMode>("transcript");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    migrateLegacySessionKeys();
    setCompletion(readAppSession(APP_SESSION_KEYS.completion));
    setFlag(readFlag());
    setOutputMode(readOutputMode());
    setReady(true);
  }, []);

  useEffect(() => {
    if (!ready) return;
    writeAppSession(APP_SESSION_KEYS.completion, completion);
  }, [completion, ready]);

  useEffect(() => {
    if (!ready) return;
    writeAppSession(APP_SESSION_KEYS.flag, flag);
  }, [flag, ready]);

  useEffect(() => {
    if (!ready) return;
    writeAppSession(APP_SESSION_KEYS.outputMode, outputMode);
  }, [outputMode, ready]);

  return (
    <CopilotSessionContext.Provider
      value={{
        completion,
        setCompletion,
        flag,
        setFlag,
        outputMode,
        setOutputMode,
      }}
    >
      {children}
    </CopilotSessionContext.Provider>
  );
}

export function useCopilotSession() {
  const ctx = useContext(CopilotSessionContext);
  if (!ctx) {
    throw new Error(
      "useCopilotSession must be used within CopilotSessionProvider",
    );
  }
  return ctx;
}
