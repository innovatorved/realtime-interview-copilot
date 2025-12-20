"use client";

import React from "react";
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
        " px-2 text-sm leading-tight break-words transition-colors",
        isFinal || segment.isFinal
          ? "text-zinc-100"
          : "text-zinc-400 opacity-75",
        className,
      )}
    >
      <span className="text-[10px] text-zinc-500 mr-2 font-mono tracking-wider">
        {formatTime(segment.startTime)} → {formatTime(segment.endTime)}
      </span>
      <span className="text-xs">{segment.text}</span>
    </div>
  );
}
