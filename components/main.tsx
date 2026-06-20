"use client";

import { Copilot } from "@/components/copilot";
import { CompactCopilot } from "@/components/CompactCopilot";
import History from "@/components/History";
import { QuestionAssistant } from "@/components/QuestionAssistant";
import { ScreenRecordingOnboard } from "@/components/ScreenRecordingOnboard";
import { AppBackdrop } from "@/components/AppBackdropContext";
import { useCaptureAndAsk } from "@/hooks/useCaptureAndAsk";
import { useClickThrough } from "@/hooks/useClickThrough";
import { useCompactWindowSize } from "@/hooks/useCompactWindowSize";
import { useNotes } from "@/hooks/useNotes";
import { useExport } from "@/hooks/useExport";
import { cn } from "@/lib/utils";
import { WORKSPACE_TABS } from "@/lib/workspace-tabs";
import { authClient } from "@/lib/auth-client";
import { sessionDisplayName, sessionUserTitle } from "@/lib/session-display";
import { useEffect, useState, useCallback, useLayoutEffect } from "react";
import { useTab } from "@/components/TabContext";
import { useInterviewContext } from "@/hooks/useInterviewContext";
import { LogOut, Mic, Minimize2 } from "lucide-react";
import { formatShortcut, Kbd } from "@/components/ui/Kbd";
import { sendGTMEvent } from "@next/third-parties/google";

export default function MainPage() {
  const { activeTab, setActiveTab, compactMode, setCompactMode } = useTab();
  const { saveContext } = useInterviewContext();
  const { data: session } = authClient.useSession();
  const [isElectron, setIsElectron] = useState(false);
  // True whenever the compact surface has an answer/error/loading panel to
  // show. Drives a window-size grow so the panel is actually visible.
  const [compactHasOutput, setCompactHasOutput] = useState(false);

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

  // Global Cmd/Ctrl+Shift+1 hotkey: main process captures the screen and
  // tells us to open Ask AI with the screenshot pre-attached.
  useCaptureAndAsk({ compactMode, setActiveTab });

  // Resize the Electron window whenever compact mode toggles. The Copilot
  // component still resizes to full size on activation, but that effect
  // only fires when activeTab is "copilot" — toggling compact wins because
  // it depends on `compactMode` directly.
  useCompactWindowSize(compactMode, compactHasOutput);

  // Reset the "has output" hint when leaving compact mode so the next time
  // we enter compact we start collapsed.
  useEffect(() => {
    if (!compactMode) setCompactHasOutput(false);
  }, [compactMode]);

  // Compact-mode click-through tracking.
  useClickThrough(compactMode, isElectron);

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

  const tabs = WORKSPACE_TABS;

  return (
    <div
      className={cn(
        "flex flex-col h-screen overflow-hidden",
        isElectron ? "bg-transparent" : "app-page-bg",
      )}
    >
      {/* Window backdrop. In compact mode navbar dimming comes from
          titlebar-chrome + app-toolbar only (no full-window sheet).
          pt-8 matches the 32px TitleBar so there is no click-through gap. */}
      <AppBackdrop clipToNavbar={compactMode} navbarHeightPx={80} />

      {!isElectron && !compactMode && (
        <header className="sticky top-0 z-40 border-b border-[color:var(--app-border)] bg-[color:color-mix(in_oklch,var(--app-surface)_94%,transparent)] backdrop-blur-md">
          <nav
            className="mx-auto flex h-14 max-w-6xl items-center gap-3 px-4 sm:gap-4 sm:px-6"
            aria-label="Primary navigation"
          >
            <div className="flex min-w-0 shrink-0 items-center gap-2 lg:gap-2.5">
              <div
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg accent-gradient shadow-md shadow-black/25"
                aria-hidden
              >
                <Mic className="h-4 w-4 text-white" />
              </div>
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold tracking-tight text-[color:var(--app-text)]">
                  Interview Copilot
                </p>
                <p className="truncate text-[11px] text-[color:var(--app-muted)]">
                  {session?.user
                    ? `Signed in as ${sessionDisplayName(session.user)}`
                    : "Transcribe, capture, answer"}
                </p>
              </div>
            </div>

            <div className="flex min-w-0 shrink-0 items-center gap-1.5 lg:gap-2">
              <div
                role="tablist"
                aria-label="Workspace"
                className="flex max-w-full items-center gap-0.5 rounded-full bg-[color:color-mix(in_oklch,var(--app-surface-elev)_88%,transparent)] p-1 ring-1 ring-white/[0.08]"
              >
                {tabs.map((tab) => {
                  const Icon = tab.icon;
                  const isActive = activeTab === tab.id;
                  return (
                    <button
                      key={tab.id}
                      type="button"
                      id={`tab-${tab.id}`}
                      role="tab"
                      aria-selected={isActive}
                      aria-controls={`panel-${tab.id}`}
                      title={`${tab.label} — ${tab.description} (${formatShortcut(["Alt", tab.shortcutKey])})`}
                      aria-label={`${tab.label}. ${tab.description}. ${formatShortcut(["Alt", tab.shortcutKey])}.`}
                      onClick={() => setActiveTab(tab.id)}
                      className={cn(
                        "flex min-w-0 max-w-[32vw] items-center gap-1.5 rounded-full px-2.5 py-2 text-xs font-medium outline-none transition-[color,background-color,box-shadow] duration-200 sm:max-w-none sm:gap-2 sm:px-3.5",
                        "focus-visible:ring-2 focus-visible:ring-[color:var(--app-ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[color:var(--app-surface)]",
                        isActive
                          ? "bg-white/[0.12] text-[color:var(--app-text)] shadow-sm ring-1 ring-white/[0.06]"
                          : "text-[color:var(--app-muted)] hover:bg-white/[0.05] hover:text-[color:var(--app-text)]",
                      )}
                    >
                      <Icon
                        className={cn(
                          "h-3.5 w-3.5 shrink-0 sm:h-4 sm:w-4",
                          isActive ? "text-emerald-400" : "opacity-80",
                        )}
                        aria-hidden
                      />
                      <span className="hidden min-w-0 truncate sm:inline">
                        {tab.label}
                      </span>
                      {isActive && (
                        <Kbd
                          keys={["Alt", tab.shortcutKey]}
                          size="xs"
                          className="hidden shrink-0 opacity-80 md:inline-flex"
                        />
                      )}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="ml-auto flex shrink-0 items-center gap-1.5 sm:gap-2">
              {session?.user && (
                <div className="hidden min-w-0 max-w-[10rem] items-center gap-1.5 rounded-full border border-[color:var(--app-border)] bg-white/[0.03] px-2 py-1.5 sm:flex md:max-w-[14rem]">
                  <span
                    className="min-w-0 truncate text-[11px] font-medium text-[color:var(--app-text)]"
                    title={sessionUserTitle(session.user)}
                  >
                    {sessionDisplayName(session.user)}
                  </span>
                  <button
                    type="button"
                    onClick={() => void handleLogout()}
                    className="shrink-0 rounded-md p-1 text-[color:var(--app-muted)] transition-colors hover:bg-red-500/15 hover:text-red-300"
                    title="Sign out"
                    aria-label="Sign out"
                  >
                    <LogOut className="h-3.5 w-3.5" />
                  </button>
                </div>
              )}
              <button
                type="button"
                onClick={() => setCompactModePersisted(true)}
                title="Compact layout (picture-in-picture style)"
                aria-label="Switch to compact mode"
                className="flex items-center gap-1.5 rounded-full border border-[color:var(--app-border)] bg-white/[0.03] px-2.5 py-2 text-xs font-medium text-[color:var(--app-muted)] transition-colors hover:bg-white/[0.06] hover:text-[color:var(--app-text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--app-ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[color:var(--app-surface)] md:px-3"
              >
                <Minimize2 className="h-3.5 w-3.5 shrink-0" aria-hidden />
                <span className="hidden lg:inline">Compact</span>
              </button>
            </div>
          </nav>
        </header>
      )}

      {topError && !dismissedError && (
        <div
          role="alert"
          className="mx-3 mt-2 flex items-start justify-between gap-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-200"
        >
          <span className="truncate">{topError}</span>
          <button
            type="button"
            className="shrink-0 text-red-300 hover:text-red-100"
            onClick={() => setDismissedError(true)}
          >
            Dismiss
          </button>
        </div>
      )}
      <main className="flex-1 overflow-hidden min-h-0">
        <div className={cn("h-full min-h-0", isElectron ? "pt-8" : "")}>
          {/* Full layout stays mounted so Copilot / Ask AI state survives compact toggles. */}
          <div
            className={cn(
              "h-full min-h-0 flex flex-col",
              compactMode && "hidden",
            )}
            aria-hidden={compactMode}
          >
            <>
              <div
                id="panel-copilot"
                role="tabpanel"
                aria-labelledby="tab-copilot"
                className={cn(
                  "h-full min-h-0 transition-opacity duration-200",
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
                  "h-full min-h-0 transition-opacity duration-200",
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
                  "h-full min-h-0 transition-opacity duration-200 overflow-hidden",
                  activeTab === "notes"
                    ? "flex flex-col opacity-100"
                    : "hidden opacity-0",
                )}
              >
                <div className="flex-1 min-h-0 overflow-hidden px-3 py-3 sm:px-4 sm:py-4">
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
            </>
          </div>

          <div
            className={cn(
              "h-full min-h-0 flex flex-col",
              !compactMode && "hidden",
            )}
            aria-hidden={!compactMode}
          >
            <CompactCopilot
              addInSavedData={({ data, tag }) => handleSaveNote(data, tag)}
              onExitCompact={() => setCompactModePersisted(false)}
              onHasOutputChange={setCompactHasOutput}
            />
          </div>
        </div>
      </main>

      <ScreenRecordingOnboard />

      {!isElectron && !compactMode && (
        <div className="sm:hidden border-t border-[color:var(--app-border)] bg-[color:color-mix(in_oklch,var(--app-surface)_96%,transparent)] px-3 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-2 backdrop-blur-md">
          <nav
            className="mx-auto flex max-w-lg items-center justify-between gap-1"
            aria-label="Primary tabs"
          >
            {tabs.map((tab) => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.id;
              const shortcut = ["Alt", tab.shortcutKey];
              return (
                <button
                  key={tab.id}
                  type="button"
                  title={`${tab.label} — ${tab.description} (${formatShortcut(shortcut)})`}
                  aria-label={`${tab.label}. ${formatShortcut(shortcut)}.`}
                  onClick={() => setActiveTab(tab.id)}
                  className={cn(
                    "flex min-w-0 flex-1 flex-col items-center gap-1 rounded-xl py-2 outline-none transition-colors",
                    "focus-visible:ring-2 focus-visible:ring-[color:var(--app-ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[color:var(--app-surface)]",
                    isActive
                      ? "bg-white/[0.1] text-[color:var(--app-text)] ring-1 ring-white/[0.06]"
                      : "text-[color:var(--app-muted)] active:bg-white/[0.05]",
                  )}
                >
                  <Icon
                    className={cn(
                      "h-5 w-5",
                      isActive ? "text-emerald-400" : "opacity-90",
                    )}
                    aria-hidden
                  />
                  <span className="max-w-full truncate px-1 text-[10px] font-medium leading-none">
                    {tab.label}
                  </span>
                </button>
              );
            })}
          </nav>
        </div>
      )}
    </div>
  );
}
