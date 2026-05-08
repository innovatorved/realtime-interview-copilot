"use client";

import { Copilot } from "@/components/copilot";
import { CompactCopilot } from "@/components/CompactCopilot";
import History from "@/components/History";
import { QuestionAssistant } from "@/components/QuestionAssistant";
import { InterviewPresets } from "@/components/InterviewPresets";
import { ScreenRecordingOnboard } from "@/components/ScreenRecordingOnboard";
import { AppBackdrop } from "@/components/AppBackdropContext";
import { useNotes } from "@/hooks/useNotes";
import { usePresets } from "@/hooks/usePresets";
import { useExport } from "@/hooks/useExport";
import { cn } from "@/lib/utils";
import { useEffect, useState, useCallback, useLayoutEffect } from "react";
import { useTab } from "@/components/TabContext";
import {
  BookOpen,
  ChevronDown,
  MessageSquare,
  Mic,
  Minimize2,
  Sparkles,
} from "lucide-react";

const NOTES_SIDEBAR_STORAGE_KEY = "interview-copilot-notes-sidebar-open";

// Electron window dimensions used when toggling compact mode. Idle compact
// height is intentionally small so only the navbar/toolbar shows; when an
// answer/summary is present we grow the window so the panel is actually
// visible on-screen instead of being clipped off the bottom of a 64px frame.
const COMPACT_WINDOW = { width: 980, height: 64 } as const;
const COMPACT_WINDOW_WITH_OUTPUT = { width: 980, height: 380 } as const;
const FULL_WINDOW = { width: 1180, height: 640 } as const;

export default function MainPage() {
  const { activeTab, setActiveTab, compactMode, setCompactMode } = useTab();
  const [presetContext, setPresetContext] = useState("");
  const [isElectron, setIsElectron] = useState(false);
  const [notesSidebarOpen, setNotesSidebarOpen] = useState(true);
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

  const { presets, error: presetsError, fetchPresets } = usePresets();
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
  useEffect(() => {
    if (typeof window === "undefined") return;
    const api = window.electronAPI;
    if (!api?.screen?.onCaptureAndAsk) return;

    const off = api.screen.onCaptureAndAsk(async () => {
      try {
        const result = await api.screen.capture();
        if (!result.success) {
          console.error("Screen capture failed:", result.error);
          return;
        }
        setActiveTab("ask-ai");
        // Broadcast to the Ask AI panel
        window.dispatchEvent(
          new CustomEvent<string>("ask-ai:attach-screenshot", {
            detail: result.dataUrl,
          }),
        );
      } catch (err) {
        console.error("Failed to handle screen capture hotkey:", err);
      }
    });

    return () => off();
  }, [setActiveTab]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const stored = localStorage.getItem(NOTES_SIDEBAR_STORAGE_KEY);
      if (stored === "0") {
        setNotesSidebarOpen(false);
      }
    } catch {
      /* ignore */
    }
  }, []);

  // Resize the Electron window whenever compact mode toggles. The Copilot
  // component still resizes to full size on activation, but that effect
  // only fires when activeTab is "copilot" — toggling compact wins because
  // it depends on `compactMode` directly.
  //
  // We also lock resizability in compact mode: a fixed-size window prevents
  // the user from accidentally drag-stretching the toolbar to full height
  // (which would leave an empty void below the controls).
  useEffect(() => {
    if (typeof window === "undefined") return;
    const api = window.electronAPI;
    if (!api?.windowSetSize) return;
    if (compactMode) {
      // Lock first, then resize, so the OS doesn't briefly let the user
      // grab a resize-edge between the two calls. When the compact surface
      // produces output we grow the window — otherwise the answer panel
      // would render off-screen below the 64px toolbar strip.
      api.windowSetResizable?.(false);
      const target = compactHasOutput
        ? COMPACT_WINDOW_WITH_OUTPUT
        : COMPACT_WINDOW;
      void api.windowSetSize(target.width, target.height);
    } else {
      void api.windowSetSize(FULL_WINDOW.width, FULL_WINDOW.height);
      api.windowSetResizable?.(true);
    }
  }, [compactMode, compactHasOutput]);

  // Reset the "has output" hint when leaving compact mode so the next time
  // we enter compact we start collapsed.
  useEffect(() => {
    if (!compactMode) setCompactHasOutput(false);
  }, [compactMode]);

  // Compact-mode click-through. The compact window is mostly transparent
  // and acts as an overlay above whatever the user is actually doing
  // (Zoom, Slack, an interview tab, etc.). Without this effect, the
  // entire window — including the empty space below the navbar — would
  // greedily capture clicks, blocking the app behind.
  //
  // Strategy: tell Electron to ignore mouse events globally on the
  // window (`setIgnoreMouseEvents(true, { forward: true })`), then track
  // the cursor in the renderer. When the cursor is over an interactive
  // region (anything marked `data-clickable`, plus standard form
  // controls, links and buttons), we flip back to non-ignored so clicks
  // land. When it leaves that region, clicks pass through to whatever
  // is behind. `forward: true` is what keeps mousemove events flowing
  // into the renderer even while ignored, which is what makes the
  // tracking work at all.
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!compactMode || !isElectron) return;
    const api = window.electronAPI;
    if (!api?.windowSetIgnoreMouseEvents) return;

    const INTERACTIVE_SELECTOR =
      '[data-clickable], button, input, textarea, select, a, [role="button"], [role="textbox"], [contenteditable="true"]';

    let lastIgnore: boolean | null = null;
    const setIgnore = (ignore: boolean) => {
      if (lastIgnore === ignore) return;
      lastIgnore = ignore;
      // Best-effort — IPC could fail mid-tear-down. Swallow.
      api
        .windowSetIgnoreMouseEvents?.(ignore, { forward: true })
        ?.catch(() => {});
    };

    // Start click-through; the cursor isn't necessarily over our window.
    setIgnore(true);

    const onMove = (e: MouseEvent) => {
      const target = document.elementFromPoint(e.clientX, e.clientY);
      if (!target) {
        setIgnore(true);
        return;
      }
      const interactive =
        target instanceof Element && target.closest(INTERACTIVE_SELECTOR);
      setIgnore(!interactive);
    };

    window.addEventListener("mousemove", onMove);

    return () => {
      window.removeEventListener("mousemove", onMove);
      // Restore normal capture so leaving compact (or unmount) doesn't
      // leave the window stuck in click-through mode.
      api.windowSetIgnoreMouseEvents?.(false)?.catch(() => {});
    };
  }, [compactMode, isElectron]);

  const setNotesSidebarPersisted = useCallback((open: boolean) => {
    setNotesSidebarOpen(open);
    try {
      localStorage.setItem(NOTES_SIDEBAR_STORAGE_KEY, open ? "1" : "0");
    } catch {
      /* ignore */
    }
  }, []);

  const toggleNotesSidebar = useCallback(() => {
    setNotesSidebarPersisted(!notesSidebarOpen);
  }, [notesSidebarOpen, setNotesSidebarPersisted]);

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
    (context: string) => {
      setPresetContext(context);
      setActiveTab("copilot");
    },
    [setActiveTab],
  );

  const tabs = [
    {
      id: "copilot" as const,
      label: "Copilot",
      icon: Mic,
      description: "Real-time interview assistant",
    },
    {
      id: "ask-ai" as const,
      label: "Ask AI",
      icon: MessageSquare,
      description: "Direct Q&A",
    },
    {
      id: "presets" as const,
      label: "Presets",
      icon: Sparkles,
      description: "Interview templates",
    },
  ];

  return (
    <div
      className={cn(
        "flex flex-col h-screen overflow-hidden",
        isElectron
          ? "bg-transparent"
          : "bg-gradient-to-br from-zinc-950 via-zinc-900 to-zinc-950",
      )}
    >
      {/* Window backdrop. In compact mode it is clipped to the navbar
          height so the area where the answer renders below is truly
          transparent (no dark sheet showing through). 80px = title bar
          (32px) + pt-10 gap + toolbar height. */}
      <AppBackdrop clipToNavbar={compactMode} navbarHeightPx={80} />

      {!isElectron && !compactMode && (
        <nav className="glass-nav sticky top-0 z-40 px-4 py-2">
          <div className="flex items-center justify-between max-w-7xl mx-auto">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-xl accent-gradient flex items-center justify-center shadow-lg">
                <Mic className="w-4 h-4 text-white" />
              </div>
              <div className="hidden sm:block">
                <h1 className="text-sm font-semibold text-white leading-none">
                  Interview Copilot
                </h1>
                <p className="text-[10px] text-zinc-500 mt-0.5">
                  AI-powered interview assistant
                </p>
              </div>
            </div>

            <div className="flex items-center gap-1 bg-zinc-900/60 rounded-xl p-1 border border-white/[0.04]">
              {tabs.map((tab) => {
                const Icon = tab.icon;
                const isActive = activeTab === tab.id;
                return (
                  <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id)}
                    className={cn(
                      "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all duration-200 border",
                      isActive ? "tab-active" : "tab-inactive",
                    )}
                  >
                    <Icon className="w-3.5 h-3.5" />
                    <span className="hidden sm:inline">{tab.label}</span>
                  </button>
                );
              })}
            </div>

            <div className="flex items-center gap-2">
              {presetContext && (
                <div className="hidden md:flex items-center gap-1.5 text-[10px] text-emerald-400/70 bg-emerald-500/[0.06] px-2.5 py-1 rounded-lg border border-emerald-500/10">
                  <Sparkles className="w-3 h-3" />
                  <span>Preset active</span>
                </div>
              )}
              <button
                type="button"
                onClick={() => setCompactMode(true)}
                title="Switch to compact mode"
                aria-label="Switch to compact mode"
                className="flex items-center gap-1 px-2 py-1.5 rounded-lg text-[10px] font-medium text-zinc-400 hover:text-zinc-100 hover:bg-white/[0.05] border border-white/[0.04] transition-colors"
              >
                <Minimize2 className="w-3 h-3" />
                <span className="hidden md:inline">Compact</span>
              </button>
            </div>
          </div>
        </nav>
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
        <div className={cn("h-full min-h-0", isElectron ? "pt-10" : "")}>
          {compactMode ? (
            <CompactCopilot
              addInSavedData={({ data, tag }) => handleSaveNote(data, tag)}
              presetContext={presetContext}
              onExitCompact={() => setCompactMode(false)}
              onHasOutputChange={setCompactHasOutput}
            />
          ) : (
            <>
              <div
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
                  />
                </div>

                <div className="flex flex-col shrink-0 md:h-full md:min-h-0">
                  <button
                    type="button"
                    className="md:hidden flex items-center justify-between gap-2 w-full px-3 py-2.5 border-t border-white/[0.08] bg-zinc-900/55 text-left text-xs text-zinc-300 hover:bg-zinc-900/80 transition-colors"
                    onClick={toggleNotesSidebar}
                    aria-expanded={notesSidebarOpen}
                  >
                    <span className="flex items-center gap-2 font-medium min-w-0">
                      <BookOpen className="w-4 h-4 shrink-0 text-emerald-500/80" />
                      <span className="truncate">Saved notes</span>
                      {pagination.total > 0 && (
                        <span className="text-[10px] text-zinc-500 tabular-nums shrink-0">
                          ({pagination.total})
                        </span>
                      )}
                    </span>
                    <ChevronDown
                      className={cn(
                        "w-4 h-4 shrink-0 text-zinc-500 transition-transform duration-200",
                        notesSidebarOpen && "rotate-180",
                      )}
                    />
                  </button>

                  <aside
                    className={cn(
                      "flex flex-col min-h-0 bg-zinc-950/50 backdrop-blur-md border-white/[0.08]",
                      "md:border-l md:border-t-0",
                      notesSidebarOpen
                        ? "flex w-full max-h-[42vh] min-h-[160px] md:min-h-0 md:max-h-none md:h-full md:w-[300px] lg:w-[320px] border-t md:border-t-0 overflow-hidden"
                        : "hidden md:flex md:w-11 md:shrink-0 md:h-full overflow-hidden",
                    )}
                  >
                    {!notesSidebarOpen ? (
                      <button
                        type="button"
                        className="hidden md:flex flex-1 flex-col items-center gap-3 pt-5 px-1 w-full min-h-0 bg-transparent hover:bg-white/[0.04] text-zinc-400 hover:text-zinc-200 transition-colors"
                        onClick={() => setNotesSidebarPersisted(true)}
                        aria-label="Open saved notes"
                      >
                        <BookOpen className="w-4 h-4 text-emerald-500/80 shrink-0" />
                        <span
                          className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500"
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
                  onClear={() => setPresetContext("")}
                />
              </div>
            </>
          )}
        </div>
      </main>

      <ScreenRecordingOnboard />

      {!isElectron && !compactMode && (
        <div className="sm:hidden glass-nav border-t border-white/[0.04] px-2 py-1.5 safe-area-inset-bottom">
          <div className="flex items-center justify-around">
            {tabs.map((tab) => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={cn(
                    "flex flex-col items-center gap-0.5 px-3 py-1 rounded-lg transition-colors",
                    isActive ? "text-emerald-400" : "text-zinc-600",
                  )}
                >
                  <Icon className="w-4 h-4" />
                  <span className="text-[9px] font-medium">{tab.label}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
