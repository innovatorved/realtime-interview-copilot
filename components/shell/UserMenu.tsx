"use client";

import { LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { sessionDisplayName, sessionUserTitle } from "@/lib/session-display";
import { cn } from "@/lib/utils";

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

  return (
    <div
      className={cn(
        "flex min-w-0 items-center gap-1.5",
        !isTitlebar &&
          "max-w-[14rem] rounded-md border border-border-subtle bg-surface-overlay px-2 py-1",
        className,
      )}
    >
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
