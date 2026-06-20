"use client";

/** Context + unified action bar on the full Copilot surface. */

import dynamic from "next/dynamic";
import {
  ChevronDown,
  FileText,
  Loader2,
  Sparkles,
  Upload,
  X,
  Zap,
} from "lucide-react";
import type { ChangeEvent, RefObject } from "react";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { hasAttachedContext } from "@/lib/prompt-context";
import { parseResumeFile } from "@/lib/resume-parser";
import { FLAGS } from "@/lib/types";

const RecorderTranscriber = dynamic(() => import("@/components/recorder"), {
  ssr: false,
  loading: () => (
    <div className="h-8 w-20 shrink-0 rounded-md bg-white/[0.04] animate-pulse" />
  ),
});

interface ContextCardProps {
  interviewNotes: string;
  onInterviewNotesChange: (value: string) => void;
  resumeText: string | null;
  resumeFileName: string | null;
  jobDescription: string;
  onJobDescriptionChange: (value: string) => void;
  onResumeParsed: (text: string, fileName: string) => void;
  onClearResume: () => void;
  isSaving?: boolean;
  isLoading?: boolean;
  formRef: RefObject<HTMLFormElement | null>;
  flag: FLAGS;
  isLoadingGenerate: boolean;
  onFlagChange: (checked: boolean) => void;
  onSubmit: (e: React.FormEvent<HTMLFormElement>) => void;
  onStop: (e?: React.MouseEvent<HTMLButtonElement>) => void;
}

export function ContextCard({
  interviewNotes,
  onInterviewNotesChange,
  resumeText,
  resumeFileName,
  jobDescription,
  onJobDescriptionChange,
  onResumeParsed,
  onClearResume,
  isSaving = false,
  isLoading = false,
  formRef,
  flag,
  isLoadingGenerate,
  onFlagChange,
  onSubmit,
  onStop,
}: ContextCardProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [isParsing, setIsParsing] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);

  const attached = hasAttachedContext({ resumeText, jobDescription });

  const handleFileChange = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setParseError(null);
    setIsParsing(true);
    try {
      const { text, fileName } = await parseResumeFile(file);
      onResumeParsed(text, fileName);
    } catch (err: unknown) {
      setParseError(
        err instanceof Error ? err.message : "Failed to parse file",
      );
    } finally {
      setIsParsing(false);
    }
  };

  return (
    <div className="glass-card p-4 flex flex-col h-full min-h-0 min-w-0 w-full overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 shrink-0 mb-2 min-w-0">
        <Label
          htmlFor="interview_notes"
          className="text-neutral-500 font-semibold tracking-wider text-[10px] uppercase flex items-center gap-1.5 min-w-0"
        >
          <Sparkles className="w-3 h-3 text-emerald-500/50 shrink-0" />
          Interview Context
        </Label>
        <div className="flex items-center gap-1.5 shrink-0">
          {resumeText?.trim() && (
            <span className="text-[9px] text-sky-300/90 bg-sky-500/[0.08] px-2 py-0.5 rounded-full border border-sky-500/15">
              Resume
            </span>
          )}
          {jobDescription.trim() && (
            <span className="text-[9px] text-violet-300/90 bg-violet-500/[0.08] px-2 py-0.5 rounded-full border border-violet-500/15">
              JD
            </span>
          )}
          {isSaving && (
            <span className="text-[9px] text-neutral-500 inline-flex items-center gap-1">
              <Loader2 className="w-3 h-3 animate-spin" />
              Saving
            </span>
          )}
        </div>
      </div>

      {/* Scrollable context body — fills space above the bottom action bar */}
      <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar flex flex-col gap-2 pr-0.5 pb-1">
        <Textarea
          id="interview_notes"
          placeholder="Role focus, talking points, or interview topic..."
          className="min-h-[72px] max-h-[96px] shrink-0 resize-none bg-transparent border-0 focus-visible:ring-0 p-0 text-neutral-200 placeholder:text-neutral-700 text-xs leading-relaxed overflow-y-auto"
          value={interviewNotes}
          onChange={(e) => onInterviewNotesChange(e.target.value)}
          disabled={isLoading}
        />

        <div className="shrink-0 border-t border-white/[0.04] pt-2">
          <button
            type="button"
            onClick={() => setDetailsOpen((open) => !open)}
            className="inline-flex items-center gap-1 text-[10px] text-neutral-500 hover:text-neutral-300 transition-colors mb-1.5"
            aria-expanded={detailsOpen}
          >
            Resume & job description
            <ChevronDown
              className={`w-3 h-3 transition-transform ${detailsOpen ? "rotate-180" : ""}`}
            />
          </button>

          {detailsOpen && (
            <div className="space-y-2 mt-1">
              <div className="flex flex-wrap items-center gap-2">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".pdf,.txt,.docx,application/pdf,text/plain,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                  className="hidden"
                  onChange={(e) => void handleFileChange(e)}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-7 text-[10px] gap-1.5 border-white/10 bg-white/[0.03] hover:bg-white/[0.06]"
                  disabled={isParsing || isLoading}
                  onClick={() => fileInputRef.current?.click()}
                >
                  {isParsing ? (
                    <Loader2 className="w-3 h-3 animate-spin" />
                  ) : (
                    <Upload className="w-3 h-3" />
                  )}
                  Upload resume
                </Button>
                {resumeFileName && (
                  <span className="inline-flex items-center gap-1 text-[10px] text-neutral-400 max-w-[140px]">
                    <FileText className="w-3 h-3 shrink-0" />
                    <span className="truncate" title={resumeFileName}>
                      {resumeFileName}
                    </span>
                    <button
                      type="button"
                      className="text-neutral-500 hover:text-neutral-300 shrink-0"
                      aria-label="Clear resume"
                      onClick={onClearResume}
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </span>
                )}
              </div>
              {parseError && (
                <p className="text-[10px] text-red-400/90">{parseError}</p>
              )}
              <div className="mt-2 mx-0.5">
                <Label
                  htmlFor="job_description"
                  className="text-[9px] uppercase tracking-wider text-neutral-600 font-medium mb-1.5 block"
                >
                  Job description
                </Label>
                <Textarea
                  id="job_description"
                  placeholder="Paste the job description..."
                  className="min-h-[56px] max-h-[80px] resize-none bg-white/[0.02] border-white/[0.06] text-xs text-neutral-300 placeholder:text-neutral-700 overflow-y-auto"
                  value={jobDescription}
                  onChange={(e) => onJobDescriptionChange(e.target.value)}
                  disabled={isLoading}
                />
              </div>
            </div>
          )}

          {!detailsOpen && attached && (
            <p className="text-[9px] text-neutral-600">
              Resume and JD saved — expand above to edit.
            </p>
          )}
        </div>
      </div>

      {/* Bottom action bar — Listen | Summarizer/Switch/Copilot | Generate */}
      <form
        ref={formRef}
        onSubmit={onSubmit}
        className="shrink-0 mt-2 pt-2 border-t border-white/[0.06] relative z-10 grid grid-cols-[1fr_auto_1fr] items-center gap-x-2 w-full min-w-0 bg-[color:color-mix(in_oklch,var(--app-surface-elev)_92%,transparent)]"
      >
        <div className="justify-self-start min-w-0">
          <RecorderTranscriber inline />
        </div>

        <div className="flex items-center gap-1.5 glass-panel px-2 py-1 shrink-0 whitespace-nowrap justify-self-center">
          <button
            type="button"
            onClick={() => onFlagChange(false)}
            title="Summarizer (S)"
            aria-label="Summarizer (S)"
            className={`h-7 px-2 rounded-md text-[11px] font-medium whitespace-nowrap transition-colors ${flag === FLAGS.SUMMARIZER ? "bg-blue-500/20 text-blue-300" : "text-neutral-500 hover:text-neutral-300 hover:bg-white/[0.04]"}`}
          >
            Summarizer
          </button>
          <Switch
            className="scale-75 data-[state=checked]:bg-emerald-500 data-[state=unchecked]:bg-neutral-700 shrink-0"
            onCheckedChange={onFlagChange}
            checked={flag === FLAGS.COPILOT}
          />
          <button
            type="button"
            onClick={() => onFlagChange(true)}
            title="Copilot (C)"
            aria-label="Copilot (C)"
            className={`h-7 px-2 rounded-md text-[11px] font-medium whitespace-nowrap transition-colors ${flag === FLAGS.COPILOT ? "bg-emerald-500/20 text-emerald-300" : "text-neutral-500 hover:text-neutral-300 hover:bg-white/[0.04]"}`}
          >
            Copilot
          </button>
        </div>

        <Button
          className="h-8 px-4 accent-gradient text-white font-medium shadow-lg hover:shadow-emerald-500/20 transition-all active:scale-[0.97] text-xs rounded-lg shrink-0 whitespace-nowrap justify-self-end"
          type={isLoadingGenerate ? "button" : "submit"}
          onClick={isLoadingGenerate ? onStop : undefined}
          title={isLoadingGenerate ? "Stop generating" : "Generate (Enter)"}
        >
          {isLoadingGenerate ? (
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
              <Zap className="w-3.5 h-3.5 shrink-0" />
              Generate
            </span>
          )}
        </Button>
      </form>
    </div>
  );
}
