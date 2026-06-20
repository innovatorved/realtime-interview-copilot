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
  return (
    <div
      className={cn(
        "px-2 py-1 text-sm leading-tight break-words transition-colors",
        overlayTextBlock,
        overlayTextShadow,
        isFinal || segment.isFinal
          ? "text-text-primary"
          : "text-text-secondary opacity-90",
        className,
      )}
    >
      <span className="mr-2 font-mono text-[10px] tracking-wider text-text-tertiary">
        {formatTime(segment.startTime)} → {formatTime(segment.endTime)}
      </span>
      <span className="text-xs">{segment.text}</span>
    </div>
  );
}
