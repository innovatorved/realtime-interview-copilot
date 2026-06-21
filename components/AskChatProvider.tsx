"use client";

/**
 * Single Ask AI conversation shared by the full Ask tab and compact drawer.
 */

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  type ReactNode,
} from "react";
import { useInterviewContext } from "@/components/InterviewContextProvider";
import { useAskChat, type UseAskChatHandle } from "@/hooks/useAskChat";
import {
  APP_SESSION_KEYS,
  migrateLegacySessionKeys,
} from "@/lib/app-session-storage";
import { buildContextBlock } from "@/lib/prompt-context";

const ASK_AI_BACKGROUND =
  "Optional interview-prep context below (talking points, role focus). Use it when relevant to the user's question.";

const AskChatContext = createContext<UseAskChatHandle | null>(null);

export function AskChatProvider({ children }: { children: ReactNode }) {
  useEffect(() => {
    migrateLegacySessionKeys();
  }, []);

  const { interviewNotes, resumeText, jobDescription } = useInterviewContext();

  const background = useMemo(
    () =>
      buildContextBlock({
        existingBg: [ASK_AI_BACKGROUND, interviewNotes.trim()]
          .filter(Boolean)
          .join("\n\n"),
        resumeText,
        jobDescription,
      }),
    [interviewNotes, resumeText, jobDescription],
  );

  const chat = useAskChat({
    storageKey: APP_SESSION_KEYS.askChat,
    background,
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
