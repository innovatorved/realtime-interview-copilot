"use client";

/** Three bouncing dots used inside Compact action buttons while a
 *  completion is being generated. Pure presentational — the parent
 *  controls when it's mounted via `isLoading` checks. */

import { cn } from "@/lib/utils";

export function LoadingDots({ color = "bg-sky-300" }: { color?: string }) {
  return (
    <span className="flex items-center gap-1">
      <span className={cn("w-1 h-1 rounded-full animate-bounce", color)} />
      <span
        className={cn("w-1 h-1 rounded-full animate-bounce", color)}
        style={{ animationDelay: "120ms" }}
      />
      <span
        className={cn("w-1 h-1 rounded-full animate-bounce", color)}
        style={{ animationDelay: "240ms" }}
      />
    </span>
  );
}
