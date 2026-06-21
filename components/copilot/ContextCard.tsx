"use client";

/** Context toolbar on the full Copilot surface. */

import dynamic from "next/dynamic";
import { ChevronDown, FileText, Loader2, Upload, X, Zap } from "lucide-react";
import type { ChangeEvent, RefObject } from "react";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { hasAttachedContext } from "@/lib/prompt-context";
import { parseResumeFile } from "@/lib/resume-parser";
import { cn } from "@/lib/utils";
import { FLAGS } from "@/lib/types";

const RecorderTranscriber = dynamic(() => import("@/components/recorder"), {
  ssr: false,
  loading: () => (
    <div className="h-8 w-20 shrink-0 animate-skeleton rounded-md" />
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
    <div className="app-toolbar shrink-0 overflow-hidden rounded-lg border border-border-subtle/40">
      <form ref={formRef} onSubmit={onSubmit} className="flex flex-col">
        <div className="flex flex-wrap items-center gap-2 border-b border-border-subtle/40 px-3 py-2">
          <RecorderTranscriber inline />

          <div className="flex items-center gap-1 rounded-md border border-border-subtle/50 bg-black/10 px-1.5 py-1 backdrop-blur-[2px]">
            <button
              type="button"
              onClick={() => onFlagChange(false)}
              title="Summarizer (S)"
              className={cn(
                "rounded px-2 py-1 text-[11px] font-medium transition-colors",
                flag === FLAGS.SUMMARIZER
                  ? "bg-info/15 text-info"
                  : "text-text-tertiary hover:text-text-secondary",
              )}
            >
              Summarize
            </button>
            <Switch
              className="scale-75"
              onCheckedChange={onFlagChange}
              checked={flag === FLAGS.COPILOT}
            />
            <button
              type="button"
              onClick={() => onFlagChange(true)}
              title="Copilot (C)"
              className={cn(
                "rounded px-2 py-1 text-[11px] font-medium transition-colors",
                flag === FLAGS.COPILOT
                  ? "bg-accent-muted text-accent-text"
                  : "text-text-tertiary hover:text-text-secondary",
              )}
            >
              Copilot
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            {resumeText?.trim() && <Badge variant="secondary">Resume</Badge>}
            {jobDescription.trim() && <Badge variant="secondary">JD</Badge>}
            <button
              type="button"
              onClick={() => setDetailsOpen((open) => !open)}
              className="inline-flex items-center gap-1 text-[11px] text-text-tertiary hover:text-text-secondary"
              aria-expanded={detailsOpen}
            >
              Context
              <ChevronDown
                className={cn(
                  "h-3 w-3 transition-transform",
                  detailsOpen && "rotate-180",
                )}
              />
            </button>
            {isSaving && (
              <span className="inline-flex items-center gap-1 text-[10px] text-text-tertiary">
                <Loader2 className="h-3 w-3 animate-spin" />
                Saving
              </span>
            )}
          </div>

          <div className="ml-auto">
            <Button
              type={isLoadingGenerate ? "button" : "submit"}
              size="sm"
              onClick={isLoadingGenerate ? onStop : undefined}
              title={isLoadingGenerate ? "Stop generating" : "Generate (Enter)"}
              className="gap-1.5"
            >
              <Zap className="h-3.5 w-3.5" />
              {isLoadingGenerate ? "Stop" : "Generate"}
            </Button>
          </div>
        </div>

        {detailsOpen && (
          <div className="space-y-2 border-b border-border-subtle/40 px-3 py-2">
            <div>
              <Label htmlFor="interview_notes" className="mb-1 block">
                Interview notes
              </Label>
              <Textarea
                id="interview_notes"
                placeholder="Role focus, talking points, or interview topic..."
                className="min-h-[64px] max-h-[96px] resize-none border-border-subtle/50 bg-black/15 text-xs backdrop-blur-[2px]"
                value={interviewNotes}
                onChange={(e) => onInterviewNotesChange(e.target.value)}
                disabled={isLoading}
              />
            </div>

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
                variant="secondary"
                size="sm"
                className="h-7 gap-1.5 text-[10px]"
                disabled={isParsing || isLoading}
                onClick={() => fileInputRef.current?.click()}
              >
                {isParsing ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <Upload className="h-3 w-3" />
                )}
                Upload resume
              </Button>
              {resumeFileName && (
                <span className="inline-flex max-w-[160px] items-center gap-1 text-[10px] text-text-secondary">
                  <FileText className="h-3 w-3 shrink-0" />
                  <span className="truncate" title={resumeFileName}>
                    {resumeFileName}
                  </span>
                  <button
                    type="button"
                    className="shrink-0 text-text-tertiary hover:text-text-primary"
                    aria-label="Clear resume"
                    onClick={onClearResume}
                  >
                    <X className="h-3 w-3" />
                  </button>
                </span>
              )}
            </div>
            {parseError && (
              <p className="text-[10px] text-destructive">{parseError}</p>
            )}
            <div>
              <Label htmlFor="job_description" className="mb-1 block">
                Job description
              </Label>
              <Textarea
                id="job_description"
                placeholder="Paste the job description..."
                className="min-h-[56px] max-h-[80px] resize-none border-border-subtle/50 bg-black/15 text-xs backdrop-blur-[2px]"
                value={jobDescription}
                onChange={(e) => onJobDescriptionChange(e.target.value)}
                disabled={isLoading}
              />
            </div>
          </div>
        )}

        {!detailsOpen && attached && (
          <p className="border-b border-border-subtle/40 px-3 py-1.5 text-[10px] text-text-tertiary">
            Resume and JD saved. Open Context to edit.
          </p>
        )}
      </form>
    </div>
  );
}
