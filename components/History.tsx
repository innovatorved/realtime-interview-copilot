"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import {
  Search,
  Trash2,
  FileDown,
  FileText,
  ChevronLeft,
  ChevronRight,
  BookOpen,
  Download,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { SavedNote, PaginationInfo } from "@/lib/types";
import { cn } from "@/lib/utils";
import SafeMarkdown from "@/components/SafeMarkdown";

interface HistoryProps {
  notes: SavedNote[];
  pagination: PaginationInfo;
  isLoading: boolean;
  onPageChange: (page: number) => void;
  /** `tag` is `""` when no tag filter. */
  onSearch: (query: string, tag: string) => void;
  onDelete: (noteId: string) => void;
  onExport: (format: "markdown" | "pdf", noteIds?: string[]) => void;
  isExporting: boolean;
  /** Compact panel beside Copilot (interview view). */
  variant?: "page" | "sidebar";
  /** Collapse the notes sidebar (desktop). */
  onCollapseSidebar?: () => void;
}

export default function History({
  notes,
  pagination,
  isLoading,
  onPageChange,
  onSearch,
  onDelete,
  onExport,
  isExporting,
  variant = "page",
  onCollapseSidebar,
}: HistoryProps) {
  const isSidebar = variant === "sidebar";
  const [searchQuery, setSearchQuery] = useState("");
  const [expandedNote, setExpandedNote] = useState<string | null>(null);
  const [selectedNotes, setSelectedNotes] = useState<Set<string>>(new Set());
  const [activeTag, setActiveTag] = useState<string>("");
  const searchTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleSearchChange = useCallback(
    (value: string) => {
      setSearchQuery(value);
      if (searchTimeout.current) clearTimeout(searchTimeout.current);
      searchTimeout.current = setTimeout(() => {
        onSearch(value, activeTag);
      }, 300);
    },
    [onSearch, activeTag],
  );

  useEffect(() => {
    return () => {
      if (searchTimeout.current) clearTimeout(searchTimeout.current);
    };
  }, []);

  const toggleSelect = (id: string) => {
    setSelectedNotes((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleExport = (format: "markdown" | "pdf") => {
    const ids = selectedNotes.size > 0 ? Array.from(selectedNotes) : undefined;
    onExport(format, ids);
  };

  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    const now = new Date();
    const diff = now.getTime() - d.getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return "Just now";
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days < 7) return `${days}d ago`;
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  };

  const tagColors: Record<string, string> = {
    Copilot: "bg-accent-muted text-accent-text border-accent/20",
    Summarizer: "bg-info/10 text-info border-info/20",
  };

  const tags = ["Copilot", "Summarizer"];

  return (
    <div
      className={cn(
        "animate-fade-in-up",
        isSidebar
          ? "flex flex-col h-full min-h-0 space-y-2 px-3 py-2 md:px-3 md:py-3"
          : "mx-auto max-w-4xl space-y-0 px-4 py-4",
      )}
    >
      <div
        className={cn(
          "flex items-center justify-between shrink-0",
          isSidebar && "gap-2",
        )}
      >
        <div
          className={cn(
            "flex items-center gap-3 min-w-0",
            isSidebar && "gap-1.5",
          )}
        >
          {isSidebar && onCollapseSidebar && (
            <button
              type="button"
              onClick={onCollapseSidebar}
              className="p-1.5 rounded-lg text-neutral-500 hover:text-neutral-200 hover:bg-white/[0.06] shrink-0"
              title="Hide saved notes"
              aria-label="Hide saved notes panel"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          )}
          <div
            className={cn(
              "flex shrink-0 items-center justify-center rounded-md border border-border-subtle bg-accent-muted",
              isSidebar ? "h-8 w-8" : "h-9 w-9",
            )}
          >
            <BookOpen
              className={cn(
                "text-accent-text",
                isSidebar ? "h-4 w-4" : "h-4 w-4",
              )}
            />
          </div>
          <div className="min-w-0">
            <h2
              className={cn(
                "font-semibold leading-tight text-text-primary",
                isSidebar ? "text-xs" : "text-base",
              )}
            >
              Saved notes
            </h2>
            <p className="truncate text-[10px] text-text-tertiary">
              {pagination.total} saved
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          {selectedNotes.size > 0 && !isSidebar && (
            <span className="text-[10px] text-neutral-500 mr-1">
              {selectedNotes.size} selected
            </span>
          )}
          <Button
            variant="secondary"
            size="sm"
            className={cn(
              "gap-1.5 text-xs",
              isSidebar ? "h-7 w-7 p-0" : "h-8 px-3",
            )}
            onClick={() => handleExport("markdown")}
            disabled={isExporting || notes.length === 0}
            title="Export Markdown"
          >
            <FileDown className="w-3.5 h-3.5" />
            {!isSidebar && <span className="hidden sm:inline">Markdown</span>}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            className={cn(
              "gap-1.5 text-xs",
              isSidebar ? "h-7 w-7 p-0" : "h-8 px-3",
            )}
            onClick={() => handleExport("pdf")}
            disabled={isExporting || notes.length === 0}
            title="Export PDF"
          >
            <Download className="w-3.5 h-3.5" />
            {!isSidebar && <span className="hidden sm:inline">PDF</span>}
          </Button>
        </div>
      </div>

      <div
        className={cn(
          "sticky top-0 z-10 shrink-0 gap-2 bg-surface-base pb-3",
          isSidebar
            ? "flex flex-col"
            : "flex flex-col space-y-2 border-b border-border-subtle",
        )}
      >
        <div className={cn("flex gap-2", isSidebar && "flex-col")}>
          <div className="relative flex-1 min-w-0">
            <Search
              className={cn(
                "absolute left-2.5 top-1/2 -translate-y-1/2 text-neutral-500",
                isSidebar ? "w-3.5 h-3.5" : "w-4 h-4 left-3",
              )}
            />
            <Input
              value={searchQuery}
              onChange={(e) => handleSearchChange(e.target.value)}
              placeholder="Search…"
              className={cn(
                isSidebar ? "h-8 pl-8 text-[11px]" : "h-9 pl-9 text-sm",
              )}
            />
          </div>
          <div className="flex flex-wrap items-center gap-1">
            {tags.map((tag) => (
              <button
                key={tag}
                type="button"
                onClick={() => {
                  const next = activeTag === tag ? "" : tag;
                  setActiveTag(next);
                  onSearch(searchQuery, next);
                }}
                className={cn(
                  "rounded-lg font-medium transition-all border",
                  isSidebar
                    ? "px-2 py-1 text-[9px]"
                    : "px-2.5 py-1.5 text-[10px]",
                  activeTag === tag
                    ? (tagColors[tag] ??
                        "bg-neutral-500/10 text-neutral-400 border-neutral-500/20")
                    : "border-transparent text-text-tertiary hover:bg-surface-overlay",
                )}
              >
                {tag}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div
        className={cn(
          "space-y-3",
          isSidebar &&
            "flex-1 min-h-0 overflow-y-auto custom-scrollbar pr-0.5 space-y-2",
        )}
      >
        {isLoading && notes.length === 0 ? (
          <div className={cn("space-y-3", isSidebar && "space-y-2")}>
            {[...Array(isSidebar ? 2 : 3)].map((_, i) => (
              <div
                key={i}
                className={cn(
                  "surface-panel animate-skeleton",
                  isSidebar ? "p-2.5 space-y-2" : "p-4 space-y-3",
                )}
              >
                <div className="flex items-center gap-2">
                  <div className="h-4 w-16 bg-white/[0.06] rounded-md" />
                  <div className="h-3 w-20 bg-white/[0.04] rounded-md" />
                </div>
                <div className="space-y-2">
                  <div className="h-3 w-full bg-white/[0.04] rounded" />
                  <div className="h-3 w-4/5 bg-white/[0.04] rounded" />
                  <div className="h-3 w-2/3 bg-white/[0.04] rounded" />
                </div>
              </div>
            ))}
          </div>
        ) : notes.length === 0 ? (
          <div
            className={cn(
              "surface-panel border-dashed text-center",
              isSidebar ? "p-4" : "p-10",
            )}
          >
            <p
              className={cn(
                "font-medium text-text-secondary",
                isSidebar ? "text-[11px]" : "text-sm",
              )}
            >
              No notes yet
            </p>
            {!isSidebar && (
              <p className="mt-1 text-xs text-text-tertiary">
                Save answers from Copilot or Ask AI to see them here
              </p>
            )}
          </div>
        ) : (
          notes.map((note, idx) => {
            const isExpanded = expandedNote === note.id;
            const isSelected = selectedNotes.has(note.id);
            const previewLen = isSidebar ? 120 : 200;
            return (
              <div
                key={note.id}
                className={cn(
                  "group cursor-pointer border-b border-border-subtle transition-colors hover:bg-surface-overlay",
                  isSidebar ? "px-1 py-2.5" : "px-2 py-3",
                  isSelected && "bg-accent-muted/50",
                )}
                style={{ animationDelay: `${idx * 40}ms` }}
                onClick={() => setExpandedNote(isExpanded ? null : note.id)}
              >
                <div
                  className={cn(
                    "flex items-center justify-between",
                    isSidebar ? "mb-1.5" : "mb-2",
                  )}
                >
                  <div className="flex items-center gap-1.5 min-w-0 flex-wrap">
                    <span
                      className={cn(
                        "inline-flex items-center rounded-md font-medium border shrink-0",
                        isSidebar
                          ? "px-1.5 py-0.5 text-[9px]"
                          : "px-2 py-0.5 text-[10px]",
                        tagColors[note.tag] ??
                          "bg-neutral-500/10 text-neutral-400 border-neutral-500/20",
                      )}
                    >
                      {note.tag}
                    </span>
                    <span
                      className={cn(
                        "text-text-tertiary",
                        isSidebar ? "text-[9px]" : "text-[10px]",
                      )}
                    >
                      {formatDate(note.createdAt)}
                    </span>
                  </div>
                  <div
                    className={cn(
                      "flex items-center gap-1 transition-opacity shrink-0",
                      isSidebar
                        ? "opacity-100"
                        : "opacity-0 group-hover:opacity-100",
                    )}
                  >
                    <button
                      className="p-1.5 rounded-lg hover:bg-white/[0.06] text-neutral-500 hover:text-neutral-300 transition-colors"
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleSelect(note.id);
                      }}
                      title="Select for export"
                    >
                      <div
                        className={`w-3.5 h-3.5 rounded border transition-colors ${
                          isSelected
                            ? "bg-emerald-500 border-emerald-500"
                            : "border-neutral-600"
                        }`}
                      />
                    </button>
                    <button
                      className="p-1.5 rounded-lg hover:bg-red-500/10 text-neutral-500 hover:text-red-400 transition-colors"
                      onClick={(e) => {
                        e.stopPropagation();
                        onDelete(note.id);
                      }}
                      title="Delete note"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                <div
                  className={cn(
                    "text-text-primary leading-relaxed transition-all",
                    isSidebar ? "text-[11px]" : "text-sm",
                    isExpanded
                      ? ""
                      : isSidebar
                        ? "line-clamp-2"
                        : "line-clamp-3",
                  )}
                >
                  {isExpanded ? (
                    <div
                      className={cn(
                        "prose prose-invert prose-sm max-w-none",
                        isSidebar && "[&_*]:text-[11px]",
                      )}
                    >
                      <SafeMarkdown>{note.content}</SafeMarkdown>
                    </div>
                  ) : (
                    <p className="whitespace-pre-wrap break-words">
                      {note.content.slice(0, previewLen)}
                      {note.content.length > previewLen ? "…" : ""}
                    </p>
                  )}
                </div>

                {note.content.length > previewLen && (
                  <button
                    type="button"
                    className="mt-1.5 text-[10px] font-medium text-accent-text transition-colors hover:text-accent"
                  >
                    {isExpanded ? "Show less" : "Show more"}
                  </button>
                )}
              </div>
            );
          })
        )}
      </div>

      {pagination.totalPages > 1 && (
        <div
          className={cn(
            "flex items-center justify-center gap-2 shrink-0",
            isSidebar ? "pt-1 border-t border-white/[0.04]" : "pt-2",
          )}
        >
          <Button
            variant="secondary"
            size="sm"
            className="h-8 w-8 p-0"
            disabled={pagination.page <= 1}
            onClick={() => onPageChange(pagination.page - 1)}
          >
            <ChevronLeft className="w-4 h-4" />
          </Button>
          <div className="flex items-center gap-1">
            {Array.from(
              { length: Math.min(5, pagination.totalPages) },
              (_, i) => {
                let page: number;
                if (pagination.totalPages <= 5) {
                  page = i + 1;
                } else if (pagination.page <= 3) {
                  page = i + 1;
                } else if (pagination.page >= pagination.totalPages - 2) {
                  page = pagination.totalPages - 4 + i;
                } else {
                  page = pagination.page - 2 + i;
                }
                return (
                  <button
                    key={page}
                    onClick={() => onPageChange(page)}
                    className={`h-8 w-8 rounded-md text-xs font-medium transition-all ${
                      page === pagination.page
                        ? "border border-accent/20 bg-accent-muted text-accent-text"
                        : "text-text-tertiary hover:bg-surface-overlay hover:text-text-secondary"
                    }`}
                  >
                    {page}
                  </button>
                );
              },
            )}
          </div>
          <Button
            variant="secondary"
            size="sm"
            className="h-8 w-8 p-0"
            disabled={pagination.page >= pagination.totalPages}
            onClick={() => onPageChange(pagination.page + 1)}
          >
            <ChevronRight className="w-4 h-4" />
          </Button>
        </div>
      )}
    </div>
  );
}
