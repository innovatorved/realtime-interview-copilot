"use client";

import type { TabType } from "@/components/TabContext";
import { formatShortcut, Kbd } from "@/components/ui/Kbd";
import { cn } from "@/lib/utils";
import { WORKSPACE_TABS } from "@/lib/workspace-tabs";

type WorkspaceTabsVariant = "header" | "titlebar" | "mobile";

interface WorkspaceTabsProps {
  activeTab: TabType;
  onTabChange: (tab: TabType) => void;
  variant?: WorkspaceTabsVariant;
  className?: string;
  style?: React.CSSProperties;
}

export function WorkspaceTabs({
  activeTab,
  onTabChange,
  variant = "header",
  className,
  style,
}: WorkspaceTabsProps) {
  if (variant === "mobile") {
    return (
      <nav
        className={cn(
          "mx-auto flex max-w-lg items-center justify-between gap-1",
          className,
        )}
        aria-label="Primary tabs"
        style={style}
      >
        {WORKSPACE_TABS.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              title={`${tab.label} (${formatShortcut(["Alt", tab.shortcutKey])})`}
              aria-label={`${tab.label}. ${formatShortcut(["Alt", tab.shortcutKey])}.`}
              aria-current={isActive ? "page" : undefined}
              onClick={() => onTabChange(tab.id)}
              className={cn(
                "flex min-w-0 flex-1 flex-col items-center gap-1 rounded-md py-2 outline-none transition-colors duration-150",
                "focus-visible:ring-2 focus-visible:ring-ring",
                isActive
                  ? "text-text-primary"
                  : "text-text-tertiary active:text-text-secondary",
              )}
            >
              <Icon
                className={cn("h-5 w-5", isActive && "text-accent-text")}
                aria-hidden
              />
              <span className="max-w-full truncate px-1 text-[10px] font-medium leading-none">
                {tab.label}
              </span>
              {isActive && (
                <span
                  className="h-0.5 w-5 rounded-full bg-accent"
                  aria-hidden
                />
              )}
            </button>
          );
        })}
      </nav>
    );
  }

  const isTitlebar = variant === "titlebar";

  return (
    <div
      role="tablist"
      aria-label="Workspace"
      className={cn(
        "flex items-center",
        isTitlebar ? "gap-0" : "gap-1",
        className,
      )}
      style={style}
    >
      {WORKSPACE_TABS.map((tab) => {
        const Icon = tab.icon;
        const isActive = activeTab === tab.id;
        return (
          <button
            key={tab.id}
            type="button"
            id={`tab-${tab.id}`}
            role="tab"
            aria-selected={isActive}
            aria-controls={`panel-${tab.id}`}
            title={`${tab.label} (${formatShortcut(["Alt", tab.shortcutKey])})`}
            aria-label={`${tab.label}. ${tab.description}. ${formatShortcut(["Alt", tab.shortcutKey])}.`}
            onClick={() => onTabChange(tab.id)}
            className={cn(
              "relative inline-flex items-center gap-1.5 outline-none transition-colors duration-150",
              "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-surface-raised",
              isTitlebar
                ? "px-2.5 py-1 text-[11px] font-medium"
                : "px-3 py-2 text-xs font-medium",
              isActive
                ? "text-text-primary"
                : "text-text-tertiary hover:text-text-secondary",
            )}
          >
            <Icon
              className={cn(
                "shrink-0",
                isTitlebar ? "h-3 w-3" : "h-3.5 w-3.5",
                isActive ? "text-accent-text" : "opacity-80",
              )}
              aria-hidden
            />
            <span className={cn(!isTitlebar && "hidden sm:inline")}>
              {tab.label}
            </span>
            {isActive && (
              <>
                <span
                  className="absolute inset-x-1 -bottom-px h-0.5 rounded-full bg-accent"
                  aria-hidden
                />
                {!isTitlebar && (
                  <Kbd
                    keys={["Alt", tab.shortcutKey]}
                    size="xs"
                    className="hidden shrink-0 opacity-70 md:inline-flex"
                  />
                )}
              </>
            )}
            {isActive && isTitlebar && (
              <Kbd
                keys={["Alt", tab.shortcutKey]}
                size="xs"
                className="ml-0.5 hidden opacity-70 md:inline-flex"
              />
            )}
          </button>
        );
      })}
    </div>
  );
}
