import * as React from "react";
import { cn } from "@/lib/utils";

type VLogoProps = React.SVGProps<SVGSVGElement> & {
  size?: number;
};

export function VLogo({ size = 28, className, ...props }: VLogoProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      className={cn("shrink-0", className)}
      {...props}
    >
      <path
        d="M16 18 L32 48 L48 18"
        stroke="currentColor"
        strokeWidth="6.5"
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
  sm: { box: "h-7 w-7 rounded-[6px]", icon: 16 },
  md: { box: "h-9 w-9 rounded-[7px]", icon: 20 },
  lg: { box: "h-10 w-10 rounded-[8px]", icon: 22 },
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
