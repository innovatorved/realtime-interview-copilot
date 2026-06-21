"use client";

import type { RefObject } from "react";
import { TranscriptionDisplay } from "@/components/TranscriptionDisplay";
import {
  overlayPanel,
  overlayTextShadow,
} from "@/components/compact/compactTextStyles";
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
    <div className={`flex h-full min-h-0 flex-col p-3 ${overlayPanel}`}>
      <div className="mb-2 flex shrink-0 items-center justify-between">
        <Label
          htmlFor="transcription"
          className={`flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-text-tertiary ${overlayTextShadow}`}
        >
          <span className="h-1.5 w-1.5 animate-recording-pulse rounded-full bg-signal-copilot" />
          Live transcript
        </Label>
        <button
          type="button"
          className="rounded px-2 py-1 text-[10px] font-medium text-text-tertiary transition-colors hover:bg-destructive-muted hover:text-destructive"
          onClick={onClear}
        >
          Clear
        </button>
      </div>
      <div
        ref={transcriptionBoxRef}
        className="custom-scrollbar -mr-1 min-h-0 flex-1 overflow-y-auto pr-1"
      >
        <TranscriptionDisplay segments={segments} />
      </div>
    </div>
  );
}
