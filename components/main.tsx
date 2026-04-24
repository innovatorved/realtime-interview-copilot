"use client";

import { Copilot } from "@/components/copilot";
import History from "@/components/History";
import { QuestionAssistant } from "@/components/QuestionAssistant";
import { InterviewPresets } from "@/components/InterviewPresets";
import { ScreenRecordingOnboard } from "@/components/ScreenRecordingOnboard";
import { useNotes } from "@/hooks/useNotes";
import { usePresets } from "@/hooks/usePresets";
import { useExport } from "@/hooks/useExport";
import { cn } from "@/lib/utils";
import { useEffect, useState, useCallback, useLayoutEffect } from "react";
import { useTab } from "@/components/TabContext";
import { BookOpen, ChevronDown, Mic, MessageSquare, Sparkles } from "lucide-react";

const NOTES_SIDEBAR_STORAGE_KEY = "interview-copilot-notes-sidebar-open";

export default function MainPage() {
  const { activeTab, setActiveTab } = useTab();
  const [presetContext, setPresetContext] = useState("");
  const [isElectron, setIsElectron] = useState(false);
  const [notesSidebarOpen, setNotesSidebarOpen] = useState(true);

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
      {!isElectron && (
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
                addInSavedData={({ data, tag }) => handleSaveNote(data, tag)}
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
                      onCollapseSidebar={() => setNotesSidebarPersisted(false)}
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
        </div>
      </main>

      <ScreenRecordingOnboard />

      {!isElectron && (
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
