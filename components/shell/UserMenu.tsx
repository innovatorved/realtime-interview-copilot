"use client";

import { useEffect, useState } from "react";
import { Activity, LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { sessionDisplayName, sessionUserTitle } from "@/lib/session-display";
import { ricFetch } from "@/lib/ric-fetch";
import { cn } from "@/lib/utils";

interface QuotaSummary {
  planTier: string;
  monthlyAllowanceSeconds: number | null;
  monthlyAllowanceCompletions: number | null;
  consumedSeconds: number;
  consumedCompletions: number;
  remainingSeconds: number | null;
  remainingCompletions: number | null;
}

interface UserMenuProps {
  user: { name?: string | null; email?: string | null };
  onLogout: () => void;
  variant?: "header" | "titlebar";
  className?: string;
}

export function UserMenu({
  user,
  onLogout,
  variant = "header",
  className,
}: UserMenuProps) {
  const isTitlebar = variant === "titlebar";
  const [quota, setQuota] = useState<QuotaSummary | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function fetchQuota() {
      try {
        const res = await ricFetch("/api/usage/me?window=30d");
        if (!res.ok) return;
        const data = (await res.json()) as { quota?: QuotaSummary };
        if (!cancelled && data.quota) {
          setQuota(data.quota);
        }
      } catch {
        // Ignore network errors for optional badge
      }
    }
    void fetchQuota();
    return () => {
      cancelled = true;
    };
  }, []);

  const usageLabel = (() => {
    if (!quota) return null;
    const mins = Math.round(quota.consumedSeconds / 60);
    if (quota.monthlyAllowanceCompletions != null) {
      return `${quota.consumedCompletions}/${quota.monthlyAllowanceCompletions} AI`;
    }
    if (quota.monthlyAllowanceSeconds != null) {
      const capMins = Math.round(quota.monthlyAllowanceSeconds / 60);
      return `${mins}/${capMins}m`;
    }
    return `${quota.consumedCompletions} AI · ${mins}m`;
  })();

  const usageTitle = (() => {
    if (!quota) return "Usage statistics";
    const mins = Math.round(quota.consumedSeconds / 60);
    const tier = quota.planTier.replace(/_/g, " ");
    return `Plan: ${tier} • ${quota.consumedCompletions} AI completions • ${mins}m transcribed (30d cycle)`;
  })();

  return (
    <div
      className={cn(
        "flex min-w-0 items-center gap-1.5",
        !isTitlebar &&
          "max-w-[18rem] rounded-md border border-border-subtle bg-surface-overlay px-2 py-1",
        className,
      )}
    >
      {usageLabel && (
        <span
          className={cn(
            "inline-flex shrink-0 items-center gap-1 rounded border border-border-subtle bg-surface-raised px-1.5 py-0.5 font-mono text-text-secondary",
            isTitlebar ? "text-[9px]" : "text-[10px]",
          )}
          title={usageTitle}
        >
          <Activity className="h-2.5 w-2.5 text-accent-text" />
          {usageLabel}
        </span>
      )}
      <span
        className={cn(
          "min-w-0 truncate font-medium text-text-primary",
          isTitlebar ? "text-[10px] mr-1" : "text-[11px] hidden sm:inline",
        )}
        title={sessionUserTitle(user)}
      >
        {sessionDisplayName(user)}
      </span>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className={cn(
          "shrink-0 text-text-tertiary hover:bg-destructive-muted hover:text-destructive",
          isTitlebar ? "h-6 w-6" : "h-7 w-7",
        )}
        onClick={onLogout}
        title="Sign out"
        aria-label="Sign out"
      >
        <LogOut className={isTitlebar ? "h-3 w-3" : "h-3.5 w-3.5"} />
      </Button>
    </div>
  );
}
