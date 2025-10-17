"use client";

import React from "react";
import { TranscriptionSegment } from "@/lib/types";
import { TranscriptionLine } from "@/components/TranscriptionLine";
import { cn } from "@/lib/utils";

interface TranscriptionDisplayProps {
  segments: TranscriptionSegment[];
  className?: string;
}

export function TranscriptionDisplay({
  segments,
  className,
}: TranscriptionDisplayProps) {
  if (segments.length === 0) {
    return null;
  }

  return (
    <div className={cn("w-full space-y-2", className)}>
      {segments.map((segment) => (
        <TranscriptionLine
          key={segment.id}
          segment={segment}
          isFinal={segment.isFinal}
        />
      ))}
    </div>
  );
}
