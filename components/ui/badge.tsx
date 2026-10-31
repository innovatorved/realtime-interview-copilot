import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center rounded border px-1.5 py-0.5 font-mono text-[10px] font-medium uppercase tracking-[0.04em] transition-colors",
  {
    variants: {
      variant: {
        default: "border-accent/25 bg-accent-muted text-accent-text",
        secondary:
          "border-border-default bg-surface-overlay text-text-secondary",
        destructive:
          "border-destructive/30 bg-destructive-muted text-destructive",
        outline: "border-border-default text-text-secondary",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <div className={cn(badgeVariants({ variant }), className)} {...props} />
  );
}

export { Badge, badgeVariants };
