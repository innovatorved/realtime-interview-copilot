import * as React from "react";
import { cn } from "@/lib/utils";

type VLogoProps = React.SVGProps<SVGSVGElement> & {
  size?: number;
};

/**
 * Meeting Copilot microphone mark — matches the classic Copilot mic icon
 * updated to the monochrome Paper & Ink / Ved Gupta design system palette.
 */
export function VLogo({ size = 20, className, ...props }: VLogoProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      className={cn("shrink-0", className)}
      {...props}
    >
      <path
        d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"
        stroke="currentColor"
        strokeWidth="2.1"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M19 10v2a7 7 0 0 1-14 0v-2"
        stroke="currentColor"
        strokeWidth="2.1"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <line
        x1="12"
        x2="12"
        y1="19"
        y2="22"
        stroke="currentColor"
        strokeWidth="2.1"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

type LogoMarkProps = React.HTMLAttributes<HTMLSpanElement> & {
  size?: "xs" | "sm" | "md" | "lg";
  inverted?: boolean;
};

const BOX: Record<
  NonNullable<LogoMarkProps["size"]>,
  { box: string; icon: number }
> = {
  xs: { box: "h-5 w-5 rounded-[5px]", icon: 12 },
  sm: { box: "h-7 w-7 rounded-[6px]", icon: 15 },
  md: { box: "h-9 w-9 rounded-[7px]", icon: 18 },
  lg: { box: "h-10 w-10 rounded-[8px]", icon: 20 },
};

export function LogoMark({
  size = "md",
  inverted = false,
  className,
  ...props
}: LogoMarkProps) {
  const { box, icon } = BOX[size];
  return (
    <span
      className={cn(
        "inline-flex items-center justify-center shrink-0 select-none border transition-colors",
        box,
        inverted
          ? "bg-primary text-on-primary border-primary"
          : "bg-surface-elevated text-ink border-hairline-strong",
        className,
      )}
      {...props}
    >
      <VLogo size={icon} />
    </span>
  );
}
