"use client";

import { memo, useCallback, useState } from "react";
import { BookmarkPlus, Check, Copy, Download } from "lucide-react";
import SafeMarkdown from "@/components/SafeMarkdown";
import {
  compactTextSurface,
  overlayPanel,
  overlayTextShadow,
} from "@/components/compact/compactTextStyles";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/Kbd";

interface OutputCardProps {
  completion: string;
  onSave: () => void;
}

export const OutputCard = memo(function OutputCard({
  completion,
  onSave,
}: OutputCardProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    if (!completion.trim() || typeof navigator === "undefined") return;
    try {
      await navigator.clipboard.writeText(completion);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* ignore clipboard failures */
    }
  }, [completion]);

  const handleDownload = useCallback(() => {
    if (!completion.trim() || typeof document === "undefined") return;
    const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const blob = new Blob([completion], {
      type: "text/markdown;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `copilot-output-${stamp}.md`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }, [completion]);

  return (
    <div
      className={`flex h-full min-h-0 flex-1 flex-col overflow-hidden ${overlayPanel}`}
    >
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border-subtle/40 px-4 py-2">
        <span
          className={`min-w-0 truncate pr-2 text-[10px] font-semibold uppercase tracking-wider text-text-tertiary ${overlayTextShadow}`}
        >
          Output
        </span>
        <div className="flex shrink-0 items-center gap-1.5">
          {completion.trim() && (
            <>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-8 shrink-0 gap-1 px-2 text-[11px] text-text-secondary hover:text-text-primary"
                onClick={() => void handleCopy()}
                title="Copy output as Markdown"
                aria-label="Copy output as Markdown"
              >
                {copied ? (
                  <Check className="h-3.5 w-3.5 shrink-0 text-emerald-400" />
                ) : (
                  <Copy className="h-3.5 w-3.5 shrink-0" />
                )}
                <span className="hidden sm:inline">
                  {copied ? "Copied" : "Copy"}
                </span>
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-8 shrink-0 gap-1 px-2 text-[11px] text-text-secondary hover:text-text-primary"
                onClick={handleDownload}
                title="Download output as Markdown (.md)"
                aria-label="Download output as Markdown"
              >
                <Download className="h-3.5 w-3.5 shrink-0" />
                <span className="hidden sm:inline">.md</span>
              </Button>
            </>
          )}
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={!completion.trim()}
            className="h-8 shrink-0 gap-1.5 text-[11px]"
            onClick={onSave}
          >
            <BookmarkPlus className="h-3.5 w-3.5 shrink-0" />
            Save note
          </Button>
        </div>
      </div>

      <div className="custom-scrollbar min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-5 sm:py-5">
        {!completion ? (
          <div
            className={`flex h-full min-h-[80px] flex-col items-start justify-center px-1 ${overlayTextShadow}`}
          >
            <p className="text-sm font-medium text-text-secondary">
              Ready when you are
            </p>
            <p className="mt-1 inline-flex flex-wrap items-center gap-1.5 text-xs text-text-tertiary">
              Start recording or press
              <Kbd keys="↵" size="sm" />
              to generate
            </p>
          </div>
        ) : (
          <div
            className={`prose prose-invert prose-sm max-w-none text-sm leading-relaxed text-text-primary ${compactTextSurface} ${overlayTextShadow}`}
          >
            <SafeMarkdown>{completion}</SafeMarkdown>
          </div>
        )}
      </div>
    </div>
  );
});
