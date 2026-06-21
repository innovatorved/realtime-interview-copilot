"use client";

import { BookmarkPlus } from "lucide-react";
import SafeMarkdown from "@/components/SafeMarkdown";
import {
  compactTextSurface,
  overlayPanel,
  overlayTextShadow,
} from "@/components/compact/compactTextStyles";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/Kbd";

interface OutputCardProps {
  completion: string;
  onSave: () => void;
}

export function OutputCard({ completion, onSave }: OutputCardProps) {
  return (
    <div
      className={`flex h-full min-h-0 flex-1 flex-col overflow-hidden ${overlayPanel}`}
    >
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border-subtle/40 px-4 py-2">
        <span
          className={`min-w-0 truncate pr-2 text-[10px] font-semibold uppercase tracking-wider text-text-tertiary ${overlayTextShadow}`}
        >
          Output
        </span>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={!completion.trim()}
          className="h-8 shrink-0 gap-1.5 text-[11px]"
          onClick={onSave}
        >
          <BookmarkPlus className="h-3.5 w-3.5 shrink-0" />
          Save note
        </Button>
      </div>

      <div className="custom-scrollbar min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-5 sm:py-5">
        {!completion ? (
          <div
            className={`flex h-full min-h-[80px] flex-col items-start justify-center px-1 ${overlayTextShadow}`}
          >
            <p className="text-sm font-medium text-text-secondary">
              Ready when you are
            </p>
            <p className="mt-1 inline-flex flex-wrap items-center gap-1.5 text-xs text-text-tertiary">
              Start recording or press
              <Kbd keys="↵" size="sm" />
              to generate
            </p>
          </div>
        ) : (
          <div
            className={`prose prose-invert prose-sm max-w-none text-sm leading-relaxed text-text-primary ${compactTextSurface} ${overlayTextShadow}`}
          >
            <SafeMarkdown>{completion}</SafeMarkdown>
          </div>
        )}
      </div>
    </div>
  );
}
