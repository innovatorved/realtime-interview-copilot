"use client";

/** Hooks that own the per-surface sessionStorage state for the compact
 *  copilot. Keeps the main component focused on orchestration; the
 *  read/write/effect glue lives here. */

import { useEffect, useRef, useState } from "react";
import { FLAGS } from "@/lib/types";
import { type CompactOutputMode } from "./OutputPanel";
import { readSession, STORAGE_KEYS, writeSession } from "./storage";

/** Hydrate and persist the last single-shot completion. */
export function useCompletionState(): [
  string,
  React.Dispatch<React.SetStateAction<string>>,
] {
  const [completion, setCompletion] = useState<string>(() =>
    readSession(STORAGE_KEYS.completion),
  );
  useEffect(() => {
    writeSession(STORAGE_KEYS.completion, completion);
  }, [completion]);
  return [completion, setCompletion];
}

/** Hydrate and persist the output mode (transcript vs chat). Defaults
 *  to "transcript" for users with an existing pre-chat session and
 *  switches the first time they submit a typed Ask AI question. */
export function useOutputMode(): [
  CompactOutputMode,
  React.Dispatch<React.SetStateAction<CompactOutputMode>>,
] {
  const [outputMode, setOutputMode] = useState<CompactOutputMode>(() => {
    const stored = readSession(STORAGE_KEYS.outputMode);
    return stored === "chat" ? "chat" : "transcript";
  });
  useEffect(() => {
    writeSession(STORAGE_KEYS.outputMode, outputMode);
  }, [outputMode]);
  return [outputMode, setOutputMode];
}

/** Tracks the most recently active completion flag so "Save" can tag
 *  the saved entry correctly even after `activeFlag` resets to null. */
export function useLastFlag(activeFlag: FLAGS | null): React.MutableRefObject<FLAGS> {
  const ref = useRef<FLAGS>(
    (readSession(STORAGE_KEYS.lastFlag) as FLAGS) || FLAGS.COPILOT,
  );
  useEffect(() => {
    if (activeFlag) {
      ref.current = activeFlag;
      writeSession(STORAGE_KEYS.lastFlag, activeFlag);
    }
  }, [activeFlag]);
  return ref;
}
