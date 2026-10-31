"use client";

import { useEffect, useRef } from "react";
import {
  compactTextSurface,
  overlayTextShadow,
} from "@/components/compact/compactTextStyles";

interface CompactLiveTranscriptProps {
  text: string;
}

/** Live transcript strip for compact overlay — transparent shell, text halo. */
export function CompactLiveTranscript({ text }: CompactLiveTranscriptProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const normalized = text.replace(/\s+/g, " ").trim();

  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !normalized) return;
    el.scrollTop = el.scrollHeight;
  }, [normalized]);

  if (!normalized) return null;

  return (
    <div
      ref={scrollRef}
      data-clickable
      className="custom-scrollbar min-h-0 flex-1 overflow-y-auto border-t border-border-subtle/40 bg-transparent px-3 py-2"
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
