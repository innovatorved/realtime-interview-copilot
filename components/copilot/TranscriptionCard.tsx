"use client";

/** Live transcription card on the full Copilot surface. Pure
 *  presentational — the parent owns the autoscroll ref and segments. */

import type { RefObject } from "react";
import { TranscriptionDisplay } from "@/components/TranscriptionDisplay";
import { Label } from "@/components/ui/label";
import type { TranscriptionSegment } from "@/lib/types";

interface TranscriptionCardProps {
  transcriptionBoxRef: RefObject<HTMLDivElement | null>;
  segments: TranscriptionSegment[];
  onClear: () => void;
}

export function TranscriptionCard({
  transcriptionBoxRef,
  segments,
  onClear,
}: TranscriptionCardProps) {
  return (
    <div className="glass-card p-4 flex flex-col h-full min-h-0 overflow-hidden">
      <div className="flex items-center justify-between mb-2 shrink-0">
        <Label
          htmlFor="transcription"
          className="text-neutral-500 font-semibold tracking-wider text-[10px] uppercase flex items-center gap-1.5"
        >
          <div className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
          Live Transcription
        </Label>
        <button
          type="button"
          className="text-[10px] text-neutral-600 hover:text-red-400 transition-colors font-medium tracking-wide px-2 py-1 rounded-md hover:bg-red-500/[0.06]"
          onClick={onClear}
        >
          Clear
        </button>
      </div>
      <div
        ref={transcriptionBoxRef}
        className="flex-1 min-h-0 overflow-y-auto rounded-md custom-scrollbar -mr-2 pr-2"
      >
        <TranscriptionDisplay segments={segments} />
      </div>
    </div>
  );
}
