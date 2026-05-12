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
 * Dark, glass-style modal that matches the rest of the Electron app
 * (zinc-950 surface, white/.06 hairline, emerald accent on focus). Keeps
 * the Notion-style geometry: 12px-rounded card, generous spacing.
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
      className="fixed inset-0 z-[110] flex items-center justify-center p-4 animate-in fade-in duration-150"
      style={{
        backgroundColor: "rgba(0, 0, 0, 0.55)",
        backdropFilter: "blur(6px)",
      }}
    >
      <div
        className={cn(
          "relative w-full max-w-sm rounded-xl p-5 animate-in zoom-in-95 duration-200",
          className,
        )}
        style={{
          backgroundColor: "rgba(24, 24, 27, 0.85)",
          backdropFilter: "blur(20px)",
          border: "1px solid rgba(255, 255, 255, 0.08)",
          boxShadow:
            "0 24px 48px -8px rgba(0, 0, 0, 0.6), 0 0 0 1px rgba(255, 255, 255, 0.02) inset",
        }}
      >
        <div className="flex items-start justify-between gap-3 mb-2">
          {title && (
            <h2
              style={{
                color: "#fafafa",
                fontSize: 14,
                fontWeight: 600,
                letterSpacing: "-0.2px",
                lineHeight: 1.3,
                margin: 0,
              }}
            >
              {title}
            </h2>
          )}
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="-mr-1.5 -mt-1.5 inline-flex h-6 w-6 items-center justify-center rounded-md transition-colors"
            style={{ color: "#a1a1aa" }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = "rgba(255,255,255,0.06)";
              e.currentTarget.style.color = "#fafafa";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = "transparent";
              e.currentTarget.style.color = "#a1a1aa";
            }}
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
        <div style={{ color: "#d4d4d8", lineHeight: 1.5, fontSize: 12.5 }}>
          {children}
        </div>
      </div>
    </div>
  );
}
