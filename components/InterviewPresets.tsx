"use client";

import { useCallback, useState } from "react";
import {
  Code,
  LayoutDashboard,
  Users,
  Monitor,
  Server,
  Sparkles,
  Check,
  X,
  FileText,
  Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/Kbd";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { buildContextBlock, presetHasAttachedContext } from "@/lib/prompt-context";
import { parseResumeFile } from "@/lib/resume-parser";
import type { InterviewPreset } from "@/lib/types";
import type { PresetContextFields } from "@/hooks/usePresets";

interface InterviewPresetsProps {
  presets: InterviewPreset[];
  onApply: (context: string, preset: InterviewPreset) => void;
  activeContext: string;
  activePresetId: string | null;
  onClear: () => void;
  onSaveContext: (
    presetId: string,
    fields: PresetContextFields,
  ) => Promise<boolean>;
}

const iconMap: Record<string, React.ElementType> = {
  code: Code,
  layout: LayoutDashboard,
  users: Users,
  monitor: Monitor,
  server: Server,
};

const categoryColors: Record<
  string,
  { bg: string; border: string; text: string; glow: string }
> = {
  SWE: {
    bg: "bg-blue-500/[0.06]",
    border: "border-blue-500/10",
    text: "text-blue-400",
    glow: "hover:shadow-blue-500/5",
  },
  PM: {
    bg: "bg-purple-500/[0.06]",
    border: "border-purple-500/10",
    text: "text-purple-400",
    glow: "hover:shadow-purple-500/5",
  },
  Behavioral: {
    bg: "bg-cyan-500/[0.06]",
    border: "border-cyan-500/10",
    text: "text-cyan-400",
    glow: "hover:shadow-cyan-500/5",
  },
};

const defaultPresets: InterviewPreset[] = [
  {
    id: "preset-swe",
    name: "Software Engineer",
    category: "SWE",
    context:
      "You are interviewing for a Software Engineer role. Focus on data structures, algorithms, system design, coding patterns, and technical problem-solving. When answering, demonstrate strong CS fundamentals, clean code practices, and scalable thinking. Use STAR method for behavioral sub-questions. Reference technologies like distributed systems, databases, API design, and cloud infrastructure where relevant.",
    description:
      "Technical SWE interview with DSA, system design, and coding focus",
    icon: "code",
    isBuiltIn: true,
    userId: null,
    createdAt: "",
  },
  {
    id: "preset-pm",
    name: "Product Manager",
    category: "PM",
    context:
      "You are interviewing for a Product Manager role. Focus on product sense, metrics-driven thinking, user empathy, prioritization frameworks (RICE, ICE), and stakeholder management. Structure answers using frameworks like CIRCLES for product design, and demonstrate ability to define success metrics, create roadmaps, and make data-informed decisions.",
    description: "Product management interview with strategy and metrics focus",
    icon: "layout",
    isBuiltIn: true,
    userId: null,
    createdAt: "",
  },
  {
    id: "preset-behavioral",
    name: "Behavioral",
    category: "Behavioral",
    context:
      "You are in a behavioral interview. Use the STAR method (Situation, Task, Action, Result) for every answer. Focus on leadership, teamwork, conflict resolution, ownership, and delivering results. Provide specific examples with quantifiable outcomes. Show self-awareness, growth mindset, and alignment with company values.",
    description:
      "Behavioral interview using STAR method with leadership examples",
    icon: "users",
    isBuiltIn: true,
    userId: null,
    createdAt: "",
  },
  {
    id: "preset-frontend",
    name: "Frontend Engineer",
    category: "SWE",
    context:
      "You are interviewing for a Frontend Engineer role. Focus on React/Next.js, TypeScript, CSS architecture, performance optimization, accessibility (a11y), and modern web APIs. Demonstrate knowledge of component patterns, state management, testing strategies, bundle optimization, and responsive design.",
    description: "Frontend engineering with React, performance, and a11y focus",
    icon: "monitor",
    isBuiltIn: true,
    userId: null,
    createdAt: "",
  },
  {
    id: "preset-system-design",
    name: "System Design",
    category: "SWE",
    context:
      "You are in a system design interview. Structure answers with: Requirements gathering, High-level architecture, Deep dive into components, Scaling considerations, and Trade-offs. Cover load balancing, caching strategies, database choices (SQL vs NoSQL), message queues, CDNs, and microservices.",
    description: "System design interview with architecture and scaling focus",
    icon: "server",
    isBuiltIn: true,
    userId: null,
    createdAt: "",
  },
];

export function InterviewPresets({
  presets,
  onApply,
  activeContext,
  activePresetId,
  onClear,
  onSaveContext,
}: InterviewPresetsProps) {
  const displayPresets = presets.length > 0 ? presets : defaultPresets;
  const categories = Array.from(new Set(displayPresets.map((p) => p.category)));

  const [selectedPreset, setSelectedPreset] = useState<InterviewPreset | null>(
    null,
  );
  const [draftResumeText, setDraftResumeText] = useState("");
  const [draftResumeFileName, setDraftResumeFileName] = useState<string | null>(
    null,
  );
  const [draftJobDescription, setDraftJobDescription] = useState("");
  const [parseError, setParseError] = useState<string | null>(null);
  const [isParsing, setIsParsing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const openPresetEditor = useCallback((preset: InterviewPreset) => {
    setSelectedPreset(preset);
    setDraftResumeText(preset.resumeText ?? "");
    setDraftResumeFileName(preset.resumeFileName ?? null);
    setDraftJobDescription(preset.jobDescription ?? "");
    setParseError(null);
  }, []);

  const handleResumeFile = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      e.target.value = "";
      if (!file) return;
      setParseError(null);
      setIsParsing(true);
      try {
        const { text, fileName } = await parseResumeFile(file);
        setDraftResumeText(text);
        setDraftResumeFileName(fileName);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        setParseError(msg);
      } finally {
        setIsParsing(false);
      }
    },
    [],
  );

  const handleApplyPreset = useCallback(
    (preset: InterviewPreset) => {
      const resumeText =
        selectedPreset?.id === preset.id ? draftResumeText : preset.resumeText;
      const jobDescription =
        selectedPreset?.id === preset.id
          ? draftJobDescription
          : preset.jobDescription;
      const context = buildContextBlock({
        existingBg: preset.context,
        resumeText,
        jobDescription,
      });
      onApply(context, {
        ...preset,
        resumeText: resumeText?.trim() || null,
        jobDescription: jobDescription?.trim() || null,
      });
    },
    [
      draftJobDescription,
      draftResumeText,
      onApply,
      selectedPreset?.id,
    ],
  );

  const handleSaveContext = useCallback(async () => {
    if (!selectedPreset) return;
    setIsSaving(true);
    setParseError(null);
    try {
      const ok = await onSaveContext(selectedPreset.id, {
        resumeText: draftResumeText.trim() || null,
        resumeFileName: draftResumeFileName,
        jobDescription: draftJobDescription.trim() || null,
      });
      if (ok) {
        setSelectedPreset({
          ...selectedPreset,
          resumeText: draftResumeText.trim() || null,
          resumeFileName: draftResumeFileName,
          jobDescription: draftJobDescription.trim() || null,
        });
      }
    } finally {
      setIsSaving(false);
    }
  }, [
    draftJobDescription,
    draftResumeFileName,
    draftResumeText,
    onSaveContext,
    selectedPreset,
  ]);

  return (
    <div className="max-w-4xl mx-auto px-4 py-6 space-y-6 animate-fade-in-up">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl accent-gradient flex items-center justify-center shadow-lg">
            <Sparkles className="w-5 h-5 text-white" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-white">
              Interview Presets
            </h2>
            <p className="text-xs text-neutral-500">
              One-click context templates for different interview types
            </p>
          </div>
        </div>

        {activeContext && (
          <Button
            variant="ghost"
            size="sm"
            className="glass-button h-8 px-3 text-xs gap-1.5 text-red-400 hover:text-red-300 hover:bg-red-500/10"
            onClick={onClear}
          >
            <X className="w-3.5 h-3.5" />
            Clear preset
          </Button>
        )}
      </div>

      {activeContext && (
        <div className="glass-card p-4 border-emerald-500/10 bg-emerald-500/[0.03] animate-fade-in-scale">
          <div className="flex items-start gap-3">
            <div className="w-8 h-8 rounded-xl bg-emerald-500/10 flex items-center justify-center shrink-0 mt-0.5">
              <Check className="w-4 h-4 text-emerald-400" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium text-emerald-400 mb-1">
                Active Preset
              </p>
              <p className="text-xs text-neutral-400 leading-relaxed line-clamp-2">
                {activeContext}
              </p>
            </div>
          </div>
        </div>
      )}

      {selectedPreset && (
        <div className="glass-card p-4 space-y-4 border-white/[0.06]">
          <div className="flex items-center justify-between gap-2">
            <div>
              <p className="text-sm font-medium text-white">
                Attach context — {selectedPreset.name}
              </p>
              <p className="text-[11px] text-neutral-500 mt-0.5">
                Optional resume and job description are folded into the preset
                when you apply.
              </p>
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="h-8 px-2 text-neutral-400"
              onClick={() => setSelectedPreset(null)}
            >
              <X className="w-4 h-4" />
            </Button>
          </div>

          <div className="space-y-2">
            <Label className="text-[10px] uppercase tracking-wider text-neutral-500">
              Resume (.txt, .pdf, .docx)
            </Label>
            <div className="flex flex-wrap items-center gap-2">
              <label className="inline-flex items-center gap-2 h-9 px-3 rounded-lg border border-white/[0.08] bg-white/[0.03] text-xs text-neutral-300 cursor-pointer hover:bg-white/[0.06]">
                <FileText className="w-3.5 h-3.5" />
                Choose file
                <input
                  type="file"
                  accept=".txt,.pdf,.docx,text/plain,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                  className="sr-only"
                  onChange={(e) => void handleResumeFile(e)}
                  disabled={isParsing}
                />
              </label>
              {isParsing && (
                <span className="inline-flex items-center gap-1.5 text-xs text-neutral-400">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  Parsing…
                </span>
              )}
              {draftResumeFileName && !isParsing && (
                <span className="text-[11px] text-emerald-400/80 truncate max-w-[14rem]">
                  {draftResumeFileName}
                </span>
              )}
            </div>
            {parseError && (
              <p className="text-[11px] text-red-300">{parseError}</p>
            )}
          </div>

          <div className="space-y-2">
            <Label
              htmlFor="preset-jd"
              className="text-[10px] uppercase tracking-wider text-neutral-500"
            >
              Job description
            </Label>
            <Textarea
              id="preset-jd"
              placeholder="Paste the job description or role requirements…"
              className="min-h-[88px] resize-y bg-white/[0.02] border-white/[0.06] text-xs text-neutral-200"
              value={draftJobDescription}
              onChange={(e) => setDraftJobDescription(e.target.value)}
            />
          </div>

          <div className="flex flex-wrap items-center gap-2 pt-1">
            <Button
              size="sm"
              className="h-8 accent-gradient text-white text-xs"
              onClick={() => handleApplyPreset(selectedPreset)}
            >
              Apply preset
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-8 text-xs border-white/[0.08]"
              disabled={isSaving}
              onClick={() => void handleSaveContext()}
            >
              {isSaving ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" />
                  Saving…
                </>
              ) : (
                "Save context"
              )}
            </Button>
          </div>
        </div>
      )}

      {categories.map((category) => {
        const catPresets = displayPresets.filter(
          (p) => p.category === category,
        );
        const colors = categoryColors[category] ?? {
          bg: "bg-neutral-500/[0.06]",
          border: "border-neutral-500/10",
          text: "text-neutral-400",
          glow: "hover:shadow-neutral-500/5",
        };

        return (
          <div key={category}>
            <h3
              className={`text-xs font-semibold uppercase tracking-wider mb-3 ${colors.text}`}
            >
              {category}
            </h3>
            <div className="grid gap-3 sm:grid-cols-2">
              {catPresets.map((preset) => {
                const Icon = iconMap[preset.icon ?? ""] ?? Code;
                const isActive = activePresetId === preset.id;
                const hasContext = presetHasAttachedContext(preset);

                return (
                  <button
                    key={preset.id}
                    onClick={() => openPresetEditor(preset)}
                    className={`glass-card-hover p-4 text-left group transition-all ${colors.glow} hover:shadow-xl ${
                      isActive ? `${colors.border} ${colors.bg}` : ""
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      <div
                        className={`w-9 h-9 rounded-xl ${colors.bg} border ${colors.border} flex items-center justify-center shrink-0 transition-transform group-hover:scale-105`}
                      >
                        <Icon className={`w-4 h-4 ${colors.text}`} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1 flex-wrap">
                          <span className="text-sm font-medium text-white">
                            {preset.name}
                          </span>
                          {isActive && (
                            <span className="text-[9px] bg-emerald-500/10 text-emerald-400 px-1.5 py-0.5 rounded-full border border-emerald-500/20">
                              Active
                            </span>
                          )}
                          {hasContext && (
                            <span className="text-[9px] bg-sky-500/10 text-sky-300 px-1.5 py-0.5 rounded-full border border-sky-500/20">
                              Context saved
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-neutral-500 leading-relaxed line-clamp-2">
                          {preset.description}
                        </p>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}

      <div className="flex items-center justify-center pt-4">
        <p className="text-[10px] text-[color:var(--app-muted)] flex items-center gap-1 flex-wrap justify-center">
          <span>Jump here anytime:</span>
          <Kbd keys={["Alt", "P"]} size="xs" className="text-neutral-300" />
        </p>
      </div>
    </div>
  );
}
