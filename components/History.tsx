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
    Copilot: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
    Summarizer: "bg-blue-500/10 text-blue-400 border-blue-500/20",
  };

  const tags = ["Copilot", "Summarizer"];

  return (
    <div
      className={cn(
        "animate-fade-in-up",
        isSidebar
          ? "flex flex-col h-full min-h-0 space-y-2 px-3 py-2 md:px-3 md:py-3"
          : "max-w-4xl mx-auto px-4 py-6 space-y-5",
      )}
    >
      {/* Header */}
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
              className="p-1.5 rounded-lg text-zinc-500 hover:text-zinc-200 hover:bg-white/[0.06] shrink-0"
              title="Hide saved notes"
              aria-label="Hide saved notes panel"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          )}
          <div
            className={cn(
              "rounded-2xl bg-emerald-500/10 flex items-center justify-center border border-emerald-500/10 shrink-0",
              isSidebar ? "w-8 h-8" : "w-10 h-10",
            )}
          >
            <BookOpen
              className={cn("text-emerald-400", isSidebar ? "w-4 h-4" : "w-5 h-5")}
            />
          </div>
          <div className="min-w-0">
            <h2
              className={cn(
                "font-semibold text-white leading-tight",
                isSidebar ? "text-xs" : "text-lg",
              )}
            >
              Saved notes
            </h2>
            <p className="text-[10px] text-zinc-500 truncate">
              {pagination.total} saved
            </p>
          </div>
        </div>

        {/* Export buttons */}
        <div className="flex items-center gap-1 shrink-0">
          {selectedNotes.size > 0 && !isSidebar && (
            <span className="text-[10px] text-zinc-500 mr-1">
              {selectedNotes.size} selected
            </span>
          )}
          <Button
            variant="ghost"
            size="sm"
            className={cn(
              "glass-button text-xs gap-1.5",
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
            variant="ghost"
            size="sm"
            className={cn(
              "glass-button text-xs gap-1.5",
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

      {/* Search + Filter */}
      <div
        className={cn(
          "flex gap-2 shrink-0",
          isSidebar && "flex-col",
        )}
      >
        <div className="relative flex-1 min-w-0">
          <Search
            className={cn(
              "absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-500",
              isSidebar ? "w-3.5 h-3.5" : "w-4 h-4 left-3",
            )}
          />
          <Input
            value={searchQuery}
            onChange={(e) => handleSearchChange(e.target.value)}
            placeholder="Search…"
            className={cn(
              "glass-input border-0",
              isSidebar ? "pl-8 h-8 text-[11px]" : "pl-9 h-9 text-sm",
            )}
          />
        </div>
        <div className="flex items-center gap-1 flex-wrap">
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
                isSidebar ? "px-2 py-1 text-[9px]" : "px-2.5 py-1.5 text-[10px]",
                activeTag === tag
                  ? tagColors[tag] ?? "bg-zinc-500/10 text-zinc-400 border-zinc-500/20"
                  : "text-zinc-500 border-transparent hover:bg-white/[0.03]",
              )}
            >
              {tag}
            </button>
          ))}
        </div>
      </div>

      {/* Notes List */}
      <div
        className={cn(
          "space-y-3",
          isSidebar && "flex-1 min-h-0 overflow-y-auto custom-scrollbar pr-0.5 space-y-2",
        )}
      >
        {isLoading && notes.length === 0 ? (
          <div className={cn("space-y-3", isSidebar && "space-y-2")}>
            {[...Array(isSidebar ? 2 : 3)].map((_, i) => (
              <div
                key={i}
                className={cn(
                  "glass-card animate-pulse",
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
              "glass-card text-center",
              isSidebar ? "p-4" : "p-12",
            )}
          >
            <div
              className={cn(
                "rounded-2xl bg-white/[0.03] flex items-center justify-center mx-auto mb-2",
                isSidebar ? "w-10 h-10 mb-2" : "w-16 h-16 mb-4",
              )}
            >
              <FileText
                className={cn("text-zinc-600", isSidebar ? "w-5 h-5" : "w-7 h-7")}
              />
            </div>
            <p
              className={cn(
                "text-zinc-400 font-medium",
                isSidebar ? "text-[11px]" : "text-sm",
              )}
            >
              No notes yet
            </p>
            {!isSidebar && (
              <p className="text-zinc-600 text-xs mt-1">
                Save answers from the Copilot to see them here
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
                  "glass-card-hover cursor-pointer group transition-all",
                  isSidebar ? "p-2.5" : "p-4",
                  isSelected ? "border-emerald-500/20 bg-emerald-500/[0.03]" : "",
                )}
                style={{ animationDelay: `${idx * 40}ms` }}
                onClick={() =>
                  setExpandedNote(isExpanded ? null : note.id)
                }
              >
                {/* Note Header */}
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
                          "bg-zinc-500/10 text-zinc-400 border-zinc-500/20",
                      )}
                    >
                      {note.tag}
                    </span>
                    <span
                      className={cn(
                        "text-zinc-600",
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
                      className="p-1.5 rounded-lg hover:bg-white/[0.06] text-zinc-500 hover:text-zinc-300 transition-colors"
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
                            : "border-zinc-600"
                        }`}
                      />
                    </button>
                    <button
                      className="p-1.5 rounded-lg hover:bg-red-500/10 text-zinc-500 hover:text-red-400 transition-colors"
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

                {/* Note Content */}
                <div
                  className={cn(
                    "text-zinc-300 leading-relaxed transition-all",
                    isSidebar ? "text-[11px]" : "text-sm",
                    isExpanded ? "" : isSidebar ? "line-clamp-2" : "line-clamp-3",
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
                    className="text-[10px] text-emerald-500/70 hover:text-emerald-400 mt-1.5 font-medium transition-colors"
                  >
                    {isExpanded ? "Show less" : "Show more"}
                  </button>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* Pagination */}
      {pagination.totalPages > 1 && (
        <div
          className={cn(
            "flex items-center justify-center gap-2 shrink-0",
            isSidebar ? "pt-1 border-t border-white/[0.04]" : "pt-2",
          )}
        >
          <Button
            variant="ghost"
            size="sm"
            className="glass-button h-8 w-8 p-0"
            disabled={pagination.page <= 1}
            onClick={() => onPageChange(pagination.page - 1)}
          >
            <ChevronLeft className="w-4 h-4" />
          </Button>
          <div className="flex items-center gap-1">
            {Array.from({ length: Math.min(5, pagination.totalPages) }, (_, i) => {
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
                  className={`w-8 h-8 rounded-lg text-xs font-medium transition-all ${
                    page === pagination.page
                      ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                      : "text-zinc-500 hover:bg-white/[0.04] hover:text-zinc-300"
                  }`}
                >
                  {page}
                </button>
              );
            })}
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="glass-button h-8 w-8 p-0"
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
