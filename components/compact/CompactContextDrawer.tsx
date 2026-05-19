"use client";

/** Optional context drawer for the Compact surface. Pure presentational
 *  — the parent owns the `bg` state and the visibility flag. */

import { Textarea } from "@/components/ui/textarea";

interface CompactContextDrawerProps {
  bg: string;
  onChange: (value: string) => void;
}

export function CompactContextDrawer({
  bg,
  onChange,
}: CompactContextDrawerProps) {
  return (
    <div data-clickable className="app-toolbar px-3 py-2">
      <Textarea
        placeholder="Optional: paste JD, resume or topic context for higher-quality answers…"
        className="min-h-[64px] max-h-[120px] resize-none bg-[color:color-mix(in_oklch,var(--app-surface)_65%,transparent)] border border-[color:var(--app-border)] focus-visible:ring-2 focus-visible:ring-[color:var(--app-ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[color:var(--app-surface)] text-[color:var(--app-text)] placeholder:text-[color:var(--app-muted)] text-xs leading-relaxed rounded-lg px-2.5 py-1.5"
        value={bg}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}
