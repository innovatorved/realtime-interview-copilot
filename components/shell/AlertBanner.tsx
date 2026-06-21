"use client";

import { cn } from "@/lib/utils";

interface AlertBannerProps {
  message: string;
  onDismiss?: () => void;
  variant?: "error" | "warning" | "info";
  className?: string;
  action?: React.ReactNode;
}

const variantClasses = {
  error: "border-destructive/30 bg-destructive-muted text-destructive",
  warning: "border-warning/30 bg-warning/10 text-warning",
  info: "border-info/30 bg-info/10 text-info",
};

export function AlertBanner({
  message,
  onDismiss,
  variant = "error",
  className,
  action,
}: AlertBannerProps) {
  return (
    <div
      role="alert"
      className={cn(
        "flex items-start justify-between gap-3 border px-3 py-2 text-xs",
        variantClasses[variant],
        className,
      )}
    >
      <span className="min-w-0 flex-1 truncate">{message}</span>
      <div className="flex shrink-0 items-center gap-2">
        {action}
        {onDismiss && (
          <button
            type="button"
            className="text-current opacity-80 hover:opacity-100"
            onClick={onDismiss}
          >
            Dismiss
          </button>
        )}
      </div>
    </div>
  );
}
