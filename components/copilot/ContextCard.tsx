"use client";

/** Context + Mode-switcher + Generate card on the full Copilot surface. */

import { FileText, Loader2, Sparkles, Upload, X, Zap } from "lucide-react";
import type { ChangeEvent, ReactNode, RefObject } from "react";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/Kbd";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { hasAttachedContext } from "@/lib/prompt-context";
import { parseResumeFile } from "@/lib/resume-parser";
import { FLAGS } from "@/lib/types";
import { authClient } from "@/lib/auth-client";
import { sessionDisplayName, sessionUserTitle } from "@/lib/session-display";

interface ContextCardProps {
  interviewNotes: string;
  onInterviewNotesChange: (value: string) => void;
  resumeText: string | null;
  resumeFileName: string | null;
  jobDescription: string;
  onJobDescriptionChange: (value: string) => void;
  onResumeParsed: (text: string, fileName: string) => void;
  onClearResume: () => void;
  onSave: () => void;
  isSaving?: boolean;
  isLoading?: boolean;
  recorder: ReactNode;
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
  onSave,
  isSaving = false,
  isLoading = false,
  recorder,
  formRef,
  flag,
  isLoadingGenerate,
  onFlagChange,
  onSubmit,
  onStop,
}: ContextCardProps) {
  const { data: session } = authClient.useSession();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [isParsing, setIsParsing] = useState(false);

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
    <div className="glass-card p-5 flex flex-col gap-3 h-full min-h-0 overflow-hidden">
      <div className="flex items-start justify-between gap-2 shrink-0">
        <div className="min-w-0 flex flex-col gap-0.5">
          <Label
            htmlFor="interview_notes"
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
        <div className="flex items-center gap-1.5 shrink-0 flex-wrap justify-end">
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
          {attached && (
            <span className="text-[9px] text-emerald-500/60 bg-emerald-500/[0.06] px-2 py-0.5 rounded-full border border-emerald-500/10">
              Context attached
            </span>
          )}
        </div>
      </div>

      <Textarea
        id="interview_notes"
        placeholder="Role focus, talking points, or interview topic..."
        className="flex-1 min-h-[72px] resize-none bg-transparent border-0 focus-visible:ring-0 p-0 text-neutral-200 placeholder:text-neutral-700 text-xs leading-relaxed overflow-y-auto"
        value={interviewNotes}
        onChange={(e) => onInterviewNotesChange(e.target.value)}
        disabled={isLoading}
      />

      <div className="shrink-0 space-y-2 border-t border-white/[0.04] pt-2">
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
              {resumeText && (
                <span className="text-neutral-600 shrink-0">
                  · {Math.round(resumeText.length / 100) / 10}k
                </span>
              )}
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

        <div className="space-y-1">
          <Label
            htmlFor="job_description"
            className="text-[9px] uppercase tracking-wider text-neutral-600 font-medium"
          >
            Job description
          </Label>
          <Textarea
            id="job_description"
            placeholder="Paste the job description..."
            className="min-h-[56px] max-h-[80px] resize-none bg-white/[0.02] border-white/[0.06] text-xs text-neutral-300 placeholder:text-neutral-700"
            value={jobDescription}
            onChange={(e) => onJobDescriptionChange(e.target.value)}
            disabled={isLoading}
          />
        </div>

        <Button
          type="button"
          size="sm"
          className="h-7 w-full text-[10px] accent-gradient text-white"
          disabled={isSaving || isParsing || isLoading}
          onClick={onSave}
        >
          {isSaving ? (
            <>
              <Loader2 className="w-3 h-3 animate-spin mr-1.5" />
              Saving...
            </>
          ) : (
            "Save context"
          )}
        </Button>
      </div>

      <div className="pt-2 border-t border-white/[0.04] space-y-3 shrink-0">
        {recorder}

        <form
          ref={formRef}
          onSubmit={onSubmit}
          className="w-full flex items-center justify-between gap-3"
        >
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
