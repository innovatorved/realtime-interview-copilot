"use client";

import {
  Code,
  LayoutDashboard,
  Users,
  Monitor,
  Server,
  Sparkles,
  Check,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import type { InterviewPreset } from "@/lib/types";

interface InterviewPresetsProps {
  presets: InterviewPreset[];
  onApply: (context: string) => void;
  activeContext: string;
  onClear: () => void;
}

const iconMap: Record<string, React.ElementType> = {
  code: Code,
  layout: LayoutDashboard,
  users: Users,
  monitor: Monitor,
  server: Server,
};

const categoryColors: Record<string, { bg: string; border: string; text: string; glow: string }> = {
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
    bg: "bg-amber-500/[0.06]",
    border: "border-amber-500/10",
    text: "text-amber-400",
    glow: "hover:shadow-amber-500/5",
  },
};

const defaultPresets: InterviewPreset[] = [
  {
    id: "preset-swe",
    name: "Software Engineer",
    category: "SWE",
    context:
      "You are interviewing for a Software Engineer role. Focus on data structures, algorithms, system design, coding patterns, and technical problem-solving. When answering, demonstrate strong CS fundamentals, clean code practices, and scalable thinking. Use STAR method for behavioral sub-questions. Reference technologies like distributed systems, databases, API design, and cloud infrastructure where relevant.",
    description: "Technical SWE interview with DSA, system design, and coding focus",
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
    description: "Behavioral interview using STAR method with leadership examples",
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
  onClear,
}: InterviewPresetsProps) {
  const displayPresets = presets.length > 0 ? presets : defaultPresets;

  const categories = Array.from(new Set(displayPresets.map((p) => p.category)));

  return (
    <div className="max-w-4xl mx-auto px-4 py-6 space-y-6 animate-fade-in-up">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl accent-gradient flex items-center justify-center shadow-lg">
            <Sparkles className="w-5 h-5 text-white" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-white">
              Interview Presets
            </h2>
            <p className="text-xs text-zinc-500">
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

      {/* Active Preset Indicator */}
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
              <p className="text-xs text-zinc-400 leading-relaxed line-clamp-2">
                {activeContext}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Preset Categories */}
      {categories.map((category) => {
        const catPresets = displayPresets.filter(
          (p) => p.category === category,
        );
        const colors = categoryColors[category] ?? {
          bg: "bg-zinc-500/[0.06]",
          border: "border-zinc-500/10",
          text: "text-zinc-400",
          glow: "hover:shadow-zinc-500/5",
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
                const isActive = activeContext === preset.context;

                return (
                  <button
                    key={preset.id}
                    onClick={() => onApply(preset.context)}
                    className={`glass-card-hover p-4 text-left group transition-all ${colors.glow} hover:shadow-xl ${
                      isActive
                        ? `${colors.border} ${colors.bg}`
                        : ""
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      <div
                        className={`w-9 h-9 rounded-xl ${colors.bg} border ${colors.border} flex items-center justify-center shrink-0 transition-transform group-hover:scale-105`}
                      >
                        <Icon className={`w-4 h-4 ${colors.text}`} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-sm font-medium text-white">
                            {preset.name}
                          </span>
                          {isActive && (
                            <span className="text-[9px] bg-emerald-500/10 text-emerald-400 px-1.5 py-0.5 rounded-full border border-emerald-500/20">
                              Active
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-zinc-500 leading-relaxed line-clamp-2">
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

      {/* Keyboard hint */}
      <div className="flex items-center justify-center pt-4">
        <p className="text-[10px] text-zinc-600">
          Press <kbd className="px-1.5 py-0.5 rounded bg-white/[0.04] border border-white/[0.06] text-zinc-400 font-mono text-[9px]">Alt+P</kbd> to switch to presets
        </p>
      </div>
    </div>
  );
}
