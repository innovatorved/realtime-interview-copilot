"use client";

/** Optional context drawer for the Compact surface. Pure presentational
 *  — the parent owns the `bg` state and the visibility flag. */

import { overlayInput } from "@/components/compact/compactTextStyles";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

interface CompactContextDrawerProps {
  bg: string;
  onChange: (value: string) => void;
  hasSavedResumeOrJd?: boolean;
}

export function CompactContextDrawer({
  bg,
  onChange,
  hasSavedResumeOrJd = false,
}: CompactContextDrawerProps) {
  return (
    <div
      data-clickable
      className="app-toolbar space-y-1 border-t border-border-subtle px-3 py-2"
    >
      {hasSavedResumeOrJd && (
        <p className="text-[10px] text-accent-text">
          Saved resume and job description are included automatically.
        </p>
      )}
      <Textarea
        placeholder="Optional: paste JD, resume or topic context for higher-quality answers…"
        className={cn(
          "max-h-[120px] min-h-[64px] resize-none text-xs leading-relaxed",
          overlayInput,
        )}
        value={bg}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}
