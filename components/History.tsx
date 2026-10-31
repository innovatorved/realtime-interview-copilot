"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import {
  Search,
  Trash2,
  FileDown,
  ChevronLeft,
  ChevronRight,
  BookOpen,
  Download,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
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
}: HistoryProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [expandedNote, setExpandedNote] = useState<string | null>(null);
  const [selectedNotes, setSelectedNotes] = useState<Set<string>>(new Set());
  const [activeTag, setActiveTag] = useState<string>("");
  const [notePendingDelete, setNotePendingDelete] = useState<string | null>(
    null,
  );
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
    <div className="animate-fade-in-up mx-auto max-w-4xl space-y-0 px-4 py-4">
      <div className="flex items-center justify-between shrink-0 pb-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-border-default bg-accent-muted">
            <BookOpen className="h-4 w-4 text-accent-text" />
          </div>
          <div className="min-w-0">
            <h2 className="text-base font-semibold leading-tight text-text-primary">
              Saved notes
            </h2>
            <p className="truncate font-mono text-[10px] uppercase tracking-[0.04em] text-text-tertiary">
              {pagination.total} saved
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          {selectedNotes.size > 0 && (
            <span className="text-[10px] text-neutral-500 mr-1">
              {selectedNotes.size} selected
            </span>
          )}
          <Button
            variant="secondary"
            size="sm"
            className="h-8 gap-1.5 px-3 text-xs"
            onClick={() => handleExport("markdown")}
            disabled={isExporting || notes.length === 0}
            title="Export Markdown"
          >
            <FileDown className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Markdown</span>
          </Button>
          <Button
            variant="secondary"
            size="sm"
            className="h-8 gap-1.5 px-3 text-xs"
            onClick={() => handleExport("pdf")}
            disabled={isExporting || notes.length === 0}
            title="Export PDF"
          >
            <Download className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">PDF</span>
          </Button>
        </div>
      </div>

      <div className="sticky top-0 z-10 flex shrink-0 flex-col gap-2 space-y-2 border-b border-border-subtle bg-surface-base pb-3">
        <div className="flex gap-2">
          <div className="relative flex-1 min-w-0">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-500" />
            <Input
              value={searchQuery}
              onChange={(e) => handleSearchChange(e.target.value)}
              placeholder="Search…"
              className="h-9 pl-9 text-sm"
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
                  "rounded-lg px-2.5 py-1.5 text-[10px] font-medium transition-all border",
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

      <div className="space-y-3">
        {isLoading && notes.length === 0 ? (
          <div className="space-y-3">
            {[...Array(3)].map((_, i) => (
              <div
                key={i}
                className="surface-panel animate-skeleton p-4 space-y-3"
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
          <div className="surface-panel border-dashed p-10 text-center">
            <p className="text-sm font-medium text-text-secondary">
              No notes yet
            </p>
            <p className="mt-1 text-xs text-text-tertiary">
              Save answers from Copilot or Ask AI to see them here
            </p>
          </div>
        ) : (
          notes.map((note, idx) => {
            const isExpanded = expandedNote === note.id;
            const isSelected = selectedNotes.has(note.id);
            const previewLen = 200;
            return (
              <div
                key={note.id}
                className={cn(
                  "group cursor-pointer border-b border-border-subtle px-2 py-3 transition-colors hover:bg-surface-overlay focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  isSelected && "bg-accent-muted/50",
                )}
                style={{ animationDelay: `${idx * 40}ms` }}
                onClick={() => setExpandedNote(isExpanded ? null : note.id)}
                role="button"
                tabIndex={0}
                aria-expanded={isExpanded}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setExpandedNote(isExpanded ? null : note.id);
                  }
                }}
              >
                <div className="mb-2 flex items-center justify-between">
                  <div className="flex items-center gap-1.5 min-w-0 flex-wrap">
                    <span
                      className={cn(
                        "inline-flex items-center rounded-md px-2 py-0.5 text-[10px] font-medium border shrink-0",
                        tagColors[note.tag] ??
                          "bg-neutral-500/10 text-neutral-400 border-neutral-500/20",
                      )}
                    >
                      {note.tag}
                    </span>
                    <span className="text-[10px] text-text-tertiary">
                      {formatDate(note.createdAt)}
                    </span>
                  </div>
                  <div className="flex items-center gap-1 opacity-0 transition-opacity shrink-0 group-hover:opacity-100">
                    <button
                      role="checkbox"
                      aria-checked={isSelected}
                      className="p-1.5 rounded-lg hover:bg-white/[0.06] text-neutral-500 hover:text-neutral-300 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleSelect(note.id);
                      }}
                      onKeyDown={(e) => e.stopPropagation()}
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
                      className="p-1.5 rounded-lg hover:bg-red-500/10 text-neutral-500 hover:text-red-400 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      onClick={(e) => {
                        e.stopPropagation();
                        setNotePendingDelete(note.id);
                      }}
                      onKeyDown={(e) => e.stopPropagation()}
                      title="Delete note"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                <div
                  className={cn(
                    "text-sm text-text-primary leading-relaxed transition-all",
                    !isExpanded && "line-clamp-3",
                  )}
                >
                  {isExpanded ? (
                    <div className="prose prose-invert prose-sm max-w-none">
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
                    onClick={(e) => {
                      e.stopPropagation();
                      setExpandedNote(isExpanded ? null : note.id);
                    }}
                    onKeyDown={(e) => e.stopPropagation()}
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
        <div className="flex items-center justify-center gap-2 shrink-0 pt-2">
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

      <Modal
        isOpen={notePendingDelete !== null}
        onClose={() => setNotePendingDelete(null)}
        title="Delete this note?"
      >
        <p>This note will be permanently deleted. This can&apos;t be undone.</p>
        <div className="mt-4 flex justify-end gap-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setNotePendingDelete(null)}
          >
            Cancel
          </Button>
          <Button
            variant="destructive"
            size="sm"
            onClick={() => {
              if (notePendingDelete) onDelete(notePendingDelete);
              setSelectedNotes((prev) => {
                if (!notePendingDelete || !prev.has(notePendingDelete)) {
                  return prev;
                }
                const next = new Set(prev);
                next.delete(notePendingDelete);
                return next;
              });
              setNotePendingDelete(null);
            }}
          >
            Delete
          </Button>
        </div>
      </Modal>
    </div>
  );
}
