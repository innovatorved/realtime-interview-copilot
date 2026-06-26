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
      data-clickable
      className="fixed inset-0 z-[110] flex items-center justify-center bg-surface-base/80 p-4 animate-fade-in-scale"
    >
      <div
        className={cn(
          "relative w-full max-w-sm rounded-lg border border-border-subtle bg-surface-raised p-5 shadow-lg",
          className,
        )}
      >
        <div className="mb-2 flex items-start justify-between gap-3">
          {title && (
            <h2 className="m-0 text-sm font-semibold leading-snug tracking-tight text-text-primary">
              {title}
            </h2>
          )}
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="-mr-1.5 -mt-1.5 inline-flex h-7 w-7 items-center justify-center rounded-md text-text-tertiary transition-colors hover:bg-surface-overlay hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
        <div className="text-[13px] leading-relaxed text-text-secondary">
          {children}
        </div>
      </div>
    </div>
  );
}
