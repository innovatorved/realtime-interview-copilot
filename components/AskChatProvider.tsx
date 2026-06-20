"use client";

/**
 * Single Ask AI conversation shared by the full Ask tab and compact drawer.
 */

import { createContext, useContext, type ReactNode } from "react";
import { useAskChat, type UseAskChatHandle } from "@/hooks/useAskChat";
import {
  APP_SESSION_KEYS,
  migrateLegacySessionKeys,
} from "@/lib/app-session-storage";
import { useEffect } from "react";

const ASK_AI_BACKGROUND =
  "You are a professional interview coach. Provide detailed, comprehensive, interview-ready answers. When the user follows up with a clarifying question, treat it as a continuation of the same conversation and reference your earlier answers when relevant.";

const AskChatContext = createContext<UseAskChatHandle | null>(null);

export function AskChatProvider({ children }: { children: ReactNode }) {
  useEffect(() => {
    migrateLegacySessionKeys();
  }, []);

  const chat = useAskChat({
    storageKey: APP_SESSION_KEYS.askChat,
    background: ASK_AI_BACKGROUND,
    sendCap: 16,
  });

  return (
    <AskChatContext.Provider value={chat}>{children}</AskChatContext.Provider>
  );
}

export function useSharedAskChat() {
  const ctx = useContext(AskChatContext);
  if (!ctx) {
    throw new Error("useSharedAskChat must be used within AskChatProvider");
  }
  return ctx;
}
