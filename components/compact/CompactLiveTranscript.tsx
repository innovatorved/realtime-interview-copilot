"use client";

import {
  compactTextSurface,
  overlayTextShadow,
} from "@/components/compact/compactTextStyles";

interface CompactLiveTranscriptProps {
  text: string;
}

/** Live transcript strip for compact overlay — transparent shell, text halo. */
export function CompactLiveTranscript({ text }: CompactLiveTranscriptProps) {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) return null;

  return (
    <div
      data-clickable
      className="custom-scrollbar max-h-32 min-h-0 overflow-y-auto border-t border-border-subtle/40 bg-transparent px-3 py-2"
    >
      <p
        className={`mb-1 text-[10px] font-semibold uppercase tracking-wider text-text-tertiary ${overlayTextShadow}`}
      >
        Live transcript
      </p>
      <p
        className={`whitespace-pre-wrap break-words text-xs leading-relaxed text-text-primary ${compactTextSurface} ${overlayTextShadow}`}
      >
        {normalized}
      </p>
    </div>
  );
}
