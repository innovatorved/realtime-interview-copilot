"use client";

import React from "react";
import {
  overlayTextBlock,
  overlayTextShadow,
} from "@/components/compact/compactTextStyles";
import { TranscriptionSegment } from "@/lib/types";
import { cn } from "@/lib/utils";

interface TranscriptionLineProps {
  segment: TranscriptionSegment;
  isFinal?: boolean;
  className?: string;
}

const formatTime = (seconds: number): string => {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 100);
  return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}.${ms.toString().padStart(2, "0")}`;
};

export function TranscriptionLine({
  segment,
  isFinal = false,
  className,
}: TranscriptionLineProps) {
  const finalized = isFinal || segment.isFinal !== false;
  const speakerIdx =
    typeof segment.speaker === "number" ? segment.speaker : null;

  return (
    <div
      className={cn(
        "px-2 py-1 text-sm leading-tight break-words transition-colors",
        overlayTextBlock,
        overlayTextShadow,
        finalized ? "text-text-primary" : "text-text-secondary opacity-90",
        className,
      )}
    >
      <span className="mr-2 font-mono text-[10px] tracking-wider text-text-tertiary">
        {formatTime(segment.startTime)} → {formatTime(segment.endTime)}
      </span>
      {speakerIdx !== null && (
        <span
          className={cn(
            "mr-1.5 inline-flex items-center rounded px-1 py-0.2 font-mono text-[9px] font-semibold uppercase tracking-wide",
            speakerIdx % 2 === 0
              ? "border border-emerald-500/25 bg-emerald-500/10 text-emerald-300"
              : "border border-sky-500/25 bg-sky-500/10 text-sky-300",
          )}
        >
          Speaker {speakerIdx + 1}
        </span>
      )}
      <span className={cn("text-xs", !finalized && "italic")}>
        {segment.text}
      </span>
    </div>
  );
}
