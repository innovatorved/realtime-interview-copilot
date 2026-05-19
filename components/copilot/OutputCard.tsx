"use client";

/** Output card on the full Copilot surface — toolbar with Save button +
 *  scrollable body with markdown or empty state. Pure presentational. */

import { BookmarkPlus, Sparkles } from "lucide-react";
import SafeMarkdown from "@/components/SafeMarkdown";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/Kbd";

interface OutputCardProps {
  completion: string;
  onSave: () => void;
}

export function OutputCard({ completion, onSave }: OutputCardProps) {
  return (
    <div className="flex-1 min-h-0 flex flex-col glass-card overflow-hidden">
      <div className="shrink-0 flex items-center justify-between gap-3 px-4 py-2.5 border-b border-white/[0.06] bg-neutral-900/30">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-neutral-500 truncate min-w-0 pr-2">
          Output
        </span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={!completion.trim()}
          className="h-8 min-w-[7.25rem] max-w-[7.25rem] shrink-0 gap-1.5 px-2 text-[11px] font-medium rounded-lg border border-emerald-500/20 bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/25 hover:text-emerald-200 disabled:opacity-40 disabled:hover:bg-emerald-500/15 disabled:hover:text-emerald-300 disabled:cursor-not-allowed"
          onClick={onSave}
        >
          <BookmarkPlus className="w-3.5 h-3.5 shrink-0" />
          Save note
        </Button>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar px-4 py-4 sm:px-5 sm:py-5">
        {!completion ? (
          <div className="h-full min-h-[120px] flex flex-col items-center justify-center text-neutral-700 space-y-3 px-2">
            <div className="w-14 h-14 rounded-2xl bg-white/[0.03] flex items-center justify-center border border-white/[0.04]">
              <Sparkles className="w-6 h-6 text-neutral-600" />
            </div>
            <div className="text-center max-w-sm">
              <p className="text-sm font-medium text-neutral-500">
                Ready to assist
              </p>
              <p className="text-xs text-neutral-600 mt-1 inline-flex items-center gap-1.5 justify-center flex-wrap">
                Start recording or press
                <Kbd keys="↵" size="sm" />
                to generate
              </p>
            </div>
          </div>
        ) : (
          <div className="prose prose-invert prose-xs max-w-none text-neutral-300 text-xs leading-relaxed pl-0.5 pr-1">
            <SafeMarkdown>{completion}</SafeMarkdown>
          </div>
        )}
      </div>
    </div>
  );
}
