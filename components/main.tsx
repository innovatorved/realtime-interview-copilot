"use client";

import { Copilot } from "@/components/copilot";
import { CompactCopilot } from "@/components/CompactCopilot";
import History from "@/components/History";
import { QuestionAssistant } from "@/components/QuestionAssistant";
import { InterviewPresets } from "@/components/InterviewPresets";
import { ScreenRecordingOnboard } from "@/components/ScreenRecordingOnboard";
import { AppBackdrop } from "@/components/AppBackdropContext";
import { useCaptureAndAsk } from "@/hooks/useCaptureAndAsk";
import { useClickThrough } from "@/hooks/useClickThrough";
import { useCompactWindowSize } from "@/hooks/useCompactWindowSize";
import { useNotes } from "@/hooks/useNotes";
import { useNotesSidebar } from "@/hooks/useNotesSidebar";
import { usePresets } from "@/hooks/usePresets";
import { useExport } from "@/hooks/useExport";
import { presetHasAttachedContext } from "@/lib/prompt-context";
import { cn } from "@/lib/utils";
import type { InterviewPreset } from "@/lib/types";
import { authClient } from "@/lib/auth-client";
import {
  sessionDisplayName,
  sessionUserTitle,
} from "@/lib/session-display";
import { useEffect, useState, useCallback, useLayoutEffect } from "react";
import { useTab } from "@/components/TabContext";
import {
  BookOpen,
  ChevronDown,
  LogOut,
  MessageSquare,
  Mic,
  Minimize2,
  Sparkles,
} from "lucide-react";
import { formatShortcut, Kbd } from "@/components/ui/Kbd";
import { sendGTMEvent } from "@next/third-parties/google";

export default function MainPage() {
  const { activeTab, setActiveTab, compactMode, setCompactMode } = useTab();
  const { data: session } = authClient.useSession();
  const [presetContext, setPresetContext] = useState("");
  const [activePresetId, setActivePresetId] = useState<string | null>(null);
  const [hasContextAttached, setHasContextAttached] = useState(false);
  const [isElectron, setIsElectron] = useState(false);
  const {
    open: notesSidebarOpen,
    setOpenPersisted: setNotesSidebarPersisted,
    toggle: toggleNotesSidebar,
  } = useNotesSidebar();
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

  const { presets, error: presetsError, fetchPresets, updatePresetContext } =
    usePresets();
  const { isExporting, error: exportError, exportNotes } = useExport();
  const [saveNoteError, setSaveNoteError] = useState<string | null>(null);
  const [dismissedError, setDismissedError] = useState(false);
  const topError =
    saveNoteError ?? notesError ?? presetsError ?? exportError ?? null;
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

  useEffect(() => {
    fetchNotes(1);
    fetchPresets();
  }, [fetchNotes, fetchPresets]);

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

  const handleApplyPreset = useCallback(
    (context: string, preset: InterviewPreset) => {
      setPresetContext(context);
      setActivePresetId(preset.id);
      setHasContextAttached(presetHasAttachedContext(preset));
      setActiveTab("copilot");
    },
    [setActiveTab],
  );

  const handleClearPreset = useCallback(() => {
    setPresetContext("");
    setActivePresetId(null);
    setHasContextAttached(false);
  }, []);

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

  const tabs = [
    {
      id: "copilot" as const,
      label: "Copilot",
      icon: Mic,
      description: "Live transcript and model answers",
      shortcutKey: "C",
    },
    {
      id: "ask-ai" as const,
      label: "Ask AI",
      icon: MessageSquare,
      description: "Chat with context and screenshots",
      shortcutKey: "A",
    },
    {
      id: "presets" as const,
      label: "Presets",
      icon: Sparkles,
      description: "Saved system prompts and role context",
      shortcutKey: "P",
    },
  ];

  return (
    <div
      className={cn(
        "flex flex-col h-screen overflow-hidden",
        isElectron
          ? "bg-transparent"
          : "app-page-bg",
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
              {presetContext && (
                <div className="hidden items-center gap-1.5 rounded-full border border-emerald-500/20 bg-emerald-500/[0.07] px-2.5 py-1 text-[10px] font-medium text-emerald-300/90 md:flex">
                  <Sparkles className="h-3 w-3 shrink-0" aria-hidden />
                  <span className="max-w-[10rem] truncate">
                    {hasContextAttached ? "Context attached" : "Preset"}
                  </span>
                </div>
              )}
              <button
                type="button"
                onClick={() => setCompactMode(true)}
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
          {compactMode ? (
            <CompactCopilot
              addInSavedData={({ data, tag }) => handleSaveNote(data, tag)}
              presetContext={presetContext}
              hasContextAttached={hasContextAttached}
              onExitCompact={() => setCompactMode(false)}
              onHasOutputChange={setCompactHasOutput}
            />
          ) : (
            <>
              <div
                id="panel-copilot"
                role="tabpanel"
                aria-labelledby="tab-copilot"
                className={cn(
                  "h-full min-h-0 transition-opacity duration-200",
                  activeTab === "copilot"
                    ? "flex flex-col md:flex-row gap-0 md:gap-0 opacity-100"
                    : "hidden opacity-0",
                )}
              >
                <div className="flex-1 min-w-0 min-h-0 flex flex-col overflow-hidden">
                  <Copilot
                    addInSavedData={({ data, tag }) =>
                      handleSaveNote(data, tag)
                    }
                    isActive={activeTab === "copilot"}
                    presetContext={presetContext}
                    hasContextAttached={hasContextAttached}
                  />
                </div>

                <div className="flex flex-col shrink-0 md:h-full md:min-h-0">
                  <button
                    type="button"
                    className="md:hidden flex items-center justify-between gap-2 w-full px-3 py-2.5 border-t border-white/[0.08] bg-neutral-900/55 text-left text-xs text-neutral-300 hover:bg-neutral-900/80 transition-colors"
                    onClick={toggleNotesSidebar}
                    aria-expanded={notesSidebarOpen}
                  >
                    <span className="flex items-center gap-2 font-medium min-w-0">
                      <BookOpen className="w-4 h-4 shrink-0 text-emerald-500/80" />
                      <span className="truncate">Saved notes</span>
                      {pagination.total > 0 && (
                        <span className="text-[10px] text-neutral-500 tabular-nums shrink-0">
                          ({pagination.total})
                        </span>
                      )}
                    </span>
                    <ChevronDown
                      className={cn(
                        "w-4 h-4 shrink-0 text-neutral-500 transition-transform duration-200",
                        notesSidebarOpen && "rotate-180",
                      )}
                    />
                  </button>

                  <aside
                    className={cn(
                      "flex flex-col min-h-0 border-[color:var(--app-border)] bg-[color:color-mix(in_oklch,var(--app-surface)_55%,transparent)] backdrop-blur-md",
                      "md:border-l md:border-t-0",
                      notesSidebarOpen
                        ? "flex w-full max-h-[42vh] min-h-[160px] md:min-h-0 md:max-h-none md:h-full md:w-[300px] lg:w-[320px] border-t md:border-t-0 overflow-hidden"
                        : "hidden md:flex md:w-11 md:shrink-0 md:h-full overflow-hidden",
                    )}
                  >
                    {!notesSidebarOpen ? (
                      <button
                        type="button"
                        className="hidden md:flex flex-1 flex-col items-center gap-3 pt-5 px-1 w-full min-h-0 bg-transparent hover:bg-white/[0.04] text-neutral-400 hover:text-neutral-200 transition-colors"
                        onClick={() => setNotesSidebarPersisted(true)}
                        aria-label="Open saved notes"
                      >
                        <BookOpen className="w-4 h-4 text-emerald-500/80 shrink-0" />
                        <span
                          className="text-[10px] font-semibold uppercase tracking-widest text-neutral-500"
                          style={{
                            writingMode: "vertical-rl",
                            transform: "rotate(180deg)",
                          }}
                        >
                          Notes
                        </span>
                        {pagination.total > 0 && (
                          <span className="text-[9px] font-medium tabular-nums bg-emerald-500/15 text-emerald-400/90 px-1.5 py-0.5 rounded-full border border-emerald-500/25">
                            {pagination.total}
                          </span>
                        )}
                      </button>
                    ) : (
                      <div className="flex flex-col flex-1 min-h-0 min-w-0 overflow-hidden">
                        <History
                          variant="sidebar"
                          notes={notes}
                          pagination={pagination}
                          isLoading={notesLoading}
                          onPageChange={(page) => fetchNotes(page)}
                          onSearch={(q, tag) => fetchNotes(1, q, tag)}
                          onDelete={deleteNote}
                          onExport={exportNotes}
                          isExporting={isExporting}
                          onCollapseSidebar={() =>
                            setNotesSidebarPersisted(false)
                          }
                        />
                      </div>
                    )}
                  </aside>
                </div>
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
                <QuestionAssistant isActive={activeTab === "ask-ai"} />
              </div>

              <div
                id="panel-presets"
                role="tabpanel"
                aria-labelledby="tab-presets"
                className={cn(
                  "h-full overflow-y-auto custom-scrollbar transition-opacity duration-200",
                  activeTab === "presets"
                    ? "block opacity-100"
                    : "hidden opacity-0",
                )}
              >
                <InterviewPresets
                  presets={presets}
                  onApply={handleApplyPreset}
                  activeContext={presetContext}
                  activePresetId={activePresetId}
                  onClear={handleClearPreset}
                  onSaveContext={updatePresetContext}
                />
              </div>
            </>
          )}
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
