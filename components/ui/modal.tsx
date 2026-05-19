"use client";

import * as React from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
  className?: string;
}

/**
 * Modal aligned with app tokens: tinted overlay, `glass`-family border,
 * emerald focus ring. Rounded card with compact typography.
 */
export function Modal({
  isOpen,
  onClose,
  title,
  children,
  className,
}: ModalProps) {
  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[110] flex items-center justify-center p-4 animate-in fade-in duration-150 bg-[color:color-mix(in_oklch,var(--app-surface)_72%,transparent)] backdrop-blur-sm"
    >
      <div
        className={cn(
          "relative w-full max-w-sm rounded-xl border border-[color:var(--app-border)] bg-[color:color-mix(in_oklch,var(--app-surface-elev)_92%,transparent)] backdrop-blur-lg p-5 shadow-2xl animate-in zoom-in-95 duration-200",
          className,
        )}
      >
        <div className="flex items-start justify-between gap-3 mb-2">
          {title && (
            <h2 className="text-sm font-semibold text-[color:var(--app-text)] tracking-tight leading-snug m-0">
              {title}
            </h2>
          )}
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="-mr-1.5 -mt-1.5 inline-flex h-6 w-6 items-center justify-center rounded-md text-[color:var(--app-muted)] transition-colors hover:bg-white/[0.06] hover:text-[color:var(--app-text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--app-ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[color:var(--app-surface-elev)]"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
        <div className="text-[12.5px] leading-relaxed text-[color:color-mix(in_oklch,var(--app-text)_90%,transparent)]">
          {children}
        </div>
      </div>
    </div>
  );
}
