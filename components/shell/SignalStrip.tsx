"use client";

import type { TabType } from "@/components/TabContext";
import { cn } from "@/lib/utils";

interface SignalStripProps {
  activeTab: TabType;
  className?: string;
}

const signalColors: Record<TabType, string> = {
  copilot: "bg-signal-copilot",
  "ask-ai": "bg-signal-ask",
  notes: "bg-signal-notes",
};

export function SignalStrip({ activeTab, className }: SignalStripProps) {
  return (
    <div
      className={cn(
        "h-0.5 w-full shrink-0",
        signalColors[activeTab],
        className,
      )}
      aria-hidden
    />
  );
}
