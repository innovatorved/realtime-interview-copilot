"use client";

/** Context + Mode-switcher + Generate card on the full Copilot surface.
 *
 *  Pure presentational. The parent owns:
 *    - the `bg` textarea state
 *    - the recorder component (passed as `recorder`)
 *    - the form ref, submit, stop handlers
 *    - `flag` (Copilot vs Summarizer)
 *    - `isLoading` for the Generate button morph */

import { Sparkles, Zap } from "lucide-react";
import type { ReactNode, RefObject } from "react";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/Kbd";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { FLAGS } from "@/lib/types";
import { authClient } from "@/lib/auth-client";
import {
  sessionDisplayName,
  sessionUserTitle,
} from "@/lib/session-display";

interface ContextCardProps {
  bg: string;
  onBgChange: (value: string) => void;
  presetContext: string;
  hasContextAttached?: boolean;
  recorder: ReactNode;
  formRef: RefObject<HTMLFormElement | null>;
  flag: FLAGS;
  isLoading: boolean;
  onFlagChange: (checked: boolean) => void;
  onSubmit: (e: React.FormEvent<HTMLFormElement>) => void;
  onStop: (e?: React.MouseEvent<HTMLButtonElement>) => void;
}

export function ContextCard({
  bg,
  onBgChange,
  presetContext,
  hasContextAttached = false,
  recorder,
  formRef,
  flag,
  isLoading,
  onFlagChange,
  onSubmit,
  onStop,
}: ContextCardProps) {
  const { data: session } = authClient.useSession();
  return (
    <div className="glass-card p-5 flex flex-col gap-3 h-full min-h-0 overflow-hidden">
      <div className="flex items-start justify-between gap-2 shrink-0">
        <div className="min-w-0 flex flex-col gap-0.5">
          <Label
            htmlFor="system_prompt"
            className="text-neutral-500 font-semibold tracking-wider text-[10px] uppercase flex items-center gap-1.5"
          >
            <Sparkles className="w-3 h-3 text-emerald-500/50 shrink-0" />
            Interview Context
          </Label>
          {session?.user && (
            <span
              className="truncate text-[10px] font-medium text-neutral-500"
              title={sessionUserTitle(session.user)}
            >
              {sessionDisplayName(session.user)}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {hasContextAttached && (
            <span className="text-[9px] text-sky-300/90 bg-sky-500/[0.08] px-2 py-0.5 rounded-full border border-sky-500/15">
              Context attached
            </span>
          )}
          {presetContext && !hasContextAttached && (
            <span className="text-[9px] text-emerald-500/60 bg-emerald-500/[0.06] px-2 py-0.5 rounded-full border border-emerald-500/10">
              Preset loaded
            </span>
          )}
        </div>
      </div>

      <Textarea
        id="system_prompt"
        placeholder="Paste job description, resume, or interview topic here..."
        className="flex-1 min-h-0 resize-none bg-transparent border-0 focus-visible:ring-0 p-0 text-neutral-200 placeholder:text-neutral-700 text-xs leading-relaxed overflow-y-auto"
        value={bg}
        onChange={(e) => onBgChange(e.target.value)}
      />

      <div className="pt-3 border-t border-white/[0.04] space-y-3 shrink-0">
        {recorder}

        <form
          ref={formRef}
          onSubmit={onSubmit}
          className="w-full flex items-center justify-between gap-3"
        >
          {/* Mode Switcher — `S` and `C` toggle Summarizer/Copilot via
              the existing keydown handler. We render the Kbd hints
              inline so the shortcut is discoverable. */}
          <div className="flex items-center gap-2 glass-panel px-3 py-1.5">
            <button
              type="button"
              onClick={() => onFlagChange(false)}
              title="Switch to Summarizer (S)"
              className={`flex items-center gap-1 text-[10px] font-medium transition-colors ${flag === FLAGS.SUMMARIZER ? "text-blue-400" : "text-neutral-600 hover:text-neutral-400"}`}
            >
              Summarizer
              <Kbd keys="S" size="xs" />
            </button>
            <Switch
              className="scale-75 data-[state=checked]:bg-emerald-500 data-[state=unchecked]:bg-neutral-700"
              onCheckedChange={onFlagChange}
              checked={flag === FLAGS.COPILOT}
            />
            <button
              type="button"
              onClick={() => onFlagChange(true)}
              title="Switch to Copilot (C)"
              className={`flex items-center gap-1 text-[10px] font-medium transition-colors ${flag === FLAGS.COPILOT ? "text-emerald-400" : "text-neutral-600 hover:text-neutral-400"}`}
            >
              Copilot
              <Kbd keys="C" size="xs" />
            </button>
          </div>

          <Button
            className="h-9 px-6 accent-gradient text-white font-medium shadow-lg hover:shadow-emerald-500/20 transition-all active:scale-[0.97] text-xs tracking-wide rounded-xl"
            type={isLoading ? "button" : "submit"}
            onClick={isLoading ? onStop : undefined}
            title={isLoading ? "Stop generating" : "Generate (Enter)"}
          >
            {isLoading ? (
              <div className="flex items-center gap-1">
                <span
                  className="w-1 h-1 bg-white rounded-full animate-bounce"
                  style={{ animationDelay: "0ms" }}
                />
                <span
                  className="w-1 h-1 bg-white rounded-full animate-bounce"
                  style={{ animationDelay: "150ms" }}
                />
                <span
                  className="w-1 h-1 bg-white rounded-full animate-bounce"
                  style={{ animationDelay: "300ms" }}
                />
              </div>
            ) : (
              <span className="flex items-center gap-1.5">
                <Zap className="w-3.5 h-3.5" />
                Generate
                <Kbd keys="↵" size="xs" className="ml-0.5 text-white/80" />
              </span>
            )}
          </Button>
        </form>
      </div>
    </div>
  );
}
