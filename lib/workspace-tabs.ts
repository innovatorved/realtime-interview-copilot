import { BookOpen, MessageSquare, Mic, type LucideIcon } from "lucide-react";
import type { TabType } from "@/components/TabContext";

export interface WorkspaceTab {
  id: TabType;
  label: string;
  icon: LucideIcon;
  shortcutKey: string;
  description: string;
}

export const WORKSPACE_TABS: WorkspaceTab[] = [
  {
    id: "copilot",
    label: "Copilot",
    icon: Mic,
    shortcutKey: "C",
    description: "Live transcript and model answers",
  },
  {
    id: "ask-ai",
    label: "Ask AI",
    icon: MessageSquare,
    shortcutKey: "A",
    description: "Chat with context and screenshots",
  },
  {
    id: "notes",
    label: "Notes",
    icon: BookOpen,
    shortcutKey: "N",
    description: "Saved answers and exports",
  },
];
