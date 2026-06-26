"use client";

import { Copilot } from "@/components/copilot";
import { CompactCopilot } from "@/components/CompactCopilot";
import History from "@/components/History";
import { QuestionAssistant } from "@/components/QuestionAssistant";
import { ScreenRecordingOnboard } from "@/components/ScreenRecordingOnboard";
import {
  AppBackdrop,
  useAppBackdrop,
} from "@/components/AppBackdropContext";
import { AlertBanner } from "@/components/shell/AlertBanner";
import { SignalStrip } from "@/components/shell/SignalStrip";
import { UserMenu } from "@/components/shell/UserMenu";
import { WorkspaceTabs } from "@/components/shell/WorkspaceTabs";
import { useCaptureAndAsk } from "@/hooks/useCaptureAndAsk";
import { useClickThrough } from "@/hooks/useClickThrough";
import {
  useCompactWindowSize,
  COMPACT_HEIGHT_IDLE,
} from "@/hooks/useCompactWindowSize";
import { useNotes } from "@/hooks/useNotes";
import { useExport } from "@/hooks/useExport";
import { cn } from "@/lib/utils";
import { authClient } from "@/lib/auth-client";
import { sessionDisplayName } from "@/lib/session-display";
import { useEffect, useState, useCallback, useLayoutEffect } from "react";
import { useTab } from "@/components/TabContext";
import { useInterviewContext } from "@/components/InterviewContextProvider";
import { Mic, Minimize2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { sendGTMEvent } from "@next/third-parties/google";
import constants from "@/constant.json";

export default function MainPage() {
  const { activeTab, setActiveTab, compactMode, setCompactMode } = useTab();
  const { backdropOpacity } = useAppBackdrop();
  const { saveContext } = useInterviewContext();
  const { data: session } = authClient.useSession();
  const [isElectron, setIsElectron] = useState(false);
  const [compactHeight, setCompactHeight] = useState(COMPACT_HEIGHT_IDLE);

  const {
    notes,
    pagination,
    isLoading: notesLoading,
    error: notesError,
    fetchNotes,
    createNote,
    deleteNote,
  } = useNotes({ initialLimit: 8 });

  const { isExporting, error: exportError, exportNotes } = useExport();
  const [saveNoteError, setSaveNoteError] = useState<string | null>(null);
  const [dismissedError, setDismissedError] = useState(false);
  const topError = saveNoteError ?? notesError ?? exportError ?? null;
  useEffect(() => {
    if (topError) setDismissedError(false);
  }, [topError]);

  useLayoutEffect(() => {
    if (typeof window !== "undefined" && window.electronAPI) {
      setIsElectron(true);
    }
  }, []);

  useCaptureAndAsk({ compactMode, setActiveTab });
  useCompactWindowSize(compactMode, compactHeight);

  useEffect(() => {
    if (!compactMode) setCompactHeight(COMPACT_HEIGHT_IDLE);
  }, [compactMode]);

  useClickThrough(compactMode, isElectron, backdropOpacity);

  useEffect(() => {
    if (isElectron && !compactMode) {
      window.electronAPI?.windowSetIgnoreMouseEvents?.(false)?.catch(() => {});
    }
  }, [isElectron, compactMode]);

  const setCompactModePersisted = useCallback(
    (next: boolean) => {
      void saveContext().finally(() => setCompactMode(next));
    },
    [saveContext, setCompactMode],
  );

  useEffect(() => {
    const onExitCompactHotkey = (e: KeyboardEvent) => {
      if (!compactMode) return;
      if (e.altKey && e.shiftKey && e.code === "KeyF") {
        e.preventDefault();
        setCompactModePersisted(false);
      }
    };
    window.addEventListener("keydown", onExitCompactHotkey);
    return () => window.removeEventListener("keydown", onExitCompactHotkey);
  }, [compactMode, setCompactModePersisted]);

  useEffect(() => {
    fetchNotes(1);
  }, [fetchNotes]);

  const handleSaveNote = useCallback(
    async (content: string, tag: string) => {
      setSaveNoteError(null);
      const saved = await createNote(content, tag);
      if (!saved) {
        setSaveNoteError("Failed to save note. Please try again.");
      }
    },
    [createNote],
  );

  const handleLogout = useCallback(async () => {
    try {
      await authClient.signOut({
        fetchOptions: {
          onSuccess: () => {
            sendGTMEvent({ event: "logout" });
            window.dispatchEvent(new Event("auth:logout"));
          },
        },
      });
      window.dispatchEvent(new Event("auth:logout"));
    } catch {
      window.dispatchEvent(new Event("auth:logout"));
    }
  }, []);

  return (
    <div
      className={cn(
        "flex h-screen flex-col overflow-hidden",
        isElectron ? "bg-transparent" : "app-page-bg",
      )}
    >
      <AppBackdrop clipToNavbar={compactMode} navbarHeightPx={80} />

      {!isElectron && !compactMode && (
        <header className="sticky top-0 z-40 border-b border-border-subtle bg-surface-raised">
          <SignalStrip activeTab={activeTab} />
          <nav
            className="mx-auto flex h-12 max-w-6xl items-center gap-3 px-4 sm:gap-4 sm:px-6"
            aria-label="Primary navigation"
          >
            <div className="flex min-w-0 shrink-0 items-center gap-2">
              <div
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-accent text-accent-foreground"
                aria-hidden
              >
                <Mic className="h-3.5 w-3.5" />
              </div>
              <div className="min-w-0 hidden sm:block">
                <p className="truncate text-sm font-semibold tracking-tight text-text-primary">
                  {constants.displayName}
                </p>
                <p className="truncate text-[11px] text-text-tertiary">
                  {session?.user
                    ? `Signed in as ${sessionDisplayName(session.user)}`
                    : "Transcribe, capture, answer"}
                </p>
              </div>
            </div>

            <WorkspaceTabs
              activeTab={activeTab}
              onTabChange={setActiveTab}
              variant="header"
              className="min-w-0 flex-1 justify-center"
            />

            <div className="ml-auto flex shrink-0 items-center gap-1.5 sm:gap-2">
              {session?.user && (
                <UserMenu
                  user={session.user}
                  onLogout={() => void handleLogout()}
                  variant="header"
                  className="hidden sm:flex"
                />
              )}
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => setCompactModePersisted(true)}
                title="Compact layout (picture-in-picture style)"
                aria-label="Switch to compact mode"
                className="gap-1.5"
              >
                <Minimize2 className="h-3.5 w-3.5 shrink-0" aria-hidden />
                <span className="hidden lg:inline">Compact</span>
              </Button>
            </div>
          </nav>
        </header>
      )}

      {topError && !dismissedError && (
        <AlertBanner
          message={topError}
          onDismiss={() => setDismissedError(true)}
          className="mx-3 mt-2 rounded-md"
        />
      )}

      <main className="min-h-0 flex-1 overflow-hidden">
        <div className={cn("h-full min-h-0", isElectron ? "pt-8" : "")}>
          <div
            className={cn(
              "flex h-full min-h-0 flex-col",
              compactMode && "hidden",
            )}
            aria-hidden={compactMode}
          >
            {!isElectron && !compactMode && (
              <SignalStrip activeTab={activeTab} className="sm:hidden" />
            )}

            <div
              id="panel-copilot"
              role="tabpanel"
              aria-labelledby="tab-copilot"
              className={cn(
                "h-full min-h-0 transition-opacity duration-150",
                activeTab === "copilot"
                  ? "flex flex-col opacity-100"
                  : "hidden opacity-0",
              )}
            >
              <Copilot
                addInSavedData={({ data, tag }) => handleSaveNote(data, tag)}
                isActive={activeTab === "copilot" && !compactMode}
              />
            </div>

            <div
              id="panel-ask-ai"
              role="tabpanel"
              aria-labelledby="tab-ask-ai"
              className={cn(
                "h-full min-h-0 transition-opacity duration-150",
                activeTab === "ask-ai"
                  ? "flex flex-col opacity-100"
                  : "hidden opacity-0",
              )}
            >
              <QuestionAssistant
                isActive={activeTab === "ask-ai" && !compactMode}
              />
            </div>

            <div
              id="panel-notes"
              role="tabpanel"
              aria-labelledby="tab-notes"
              className={cn(
                "h-full min-h-0 overflow-hidden transition-opacity duration-150",
                activeTab === "notes"
                  ? "flex flex-col opacity-100"
                  : "hidden opacity-0",
              )}
            >
              <div className="min-h-0 flex-1 overflow-hidden px-3 py-3 sm:px-4 sm:py-4">
                <History
                  variant="page"
                  notes={notes}
                  pagination={pagination}
                  isLoading={notesLoading}
                  onPageChange={(page) => fetchNotes(page)}
                  onSearch={(q, tag) => fetchNotes(1, q, tag)}
                  onDelete={deleteNote}
                  onExport={exportNotes}
                  isExporting={isExporting}
                />
              </div>
            </div>
          </div>

          <div
            className={cn(
              "flex h-full min-h-0 flex-col",
              !compactMode && "hidden",
            )}
            aria-hidden={!compactMode}
          >
            <CompactCopilot
              addInSavedData={({ data, tag }) => handleSaveNote(data, tag)}
              onExitCompact={() => setCompactModePersisted(false)}
              onCompactHeightChange={setCompactHeight}
            />
          </div>
        </div>
      </main>

      <ScreenRecordingOnboard />

      {!isElectron && !compactMode && (
        <div className="border-t border-border-subtle bg-surface-raised px-3 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-2 sm:hidden">
          <WorkspaceTabs
            activeTab={activeTab}
            onTabChange={setActiveTab}
            variant="mobile"
          />
        </div>
      )}
    </div>
  );
}
