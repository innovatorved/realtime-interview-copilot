import * as React from "react";
import { cn } from "@/lib/utils";

type VLogoProps = React.SVGProps<SVGSVGElement> & {
  size?: number;
};

/**
 * Meeting Copilot question-mark (`?`) mark — exact geometry from the original
 * Copilot app icon, updated to the monochrome Paper & Ink / Ved Gupta palette.
 */
export function VLogo({ size = 20, className, ...props }: VLogoProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 512 512"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      className={cn("shrink-0", className)}
      {...props}
    >
      <path
        d="M 240 64 L 270 64 L 298 68 L 319 74 L 343 86 L 357 96 L 380 121 L 390 138 L 398 165 L 398 193 L 392 214 L 386 226 L 352 251 L 323 283 L 303 319 L 296 339 L 292 360 L 289 363 L 217 363 L 214 359 L 214 329 L 218 303 L 230 276 L 255 248 L 297 213 L 307 203 L 313 193 L 316 182 L 315 168 L 309 154 L 301 145 L 285 135 L 267 131 L 250 131 L 230 136 L 218 143 L 205 156 L 197 170 L 191 191 L 185 196 L 120 188 L 114 186 L 112 182 L 116 157 L 126 132 L 139 113 L 156 96 L 176 82 L 199 72 L 218 67 L 239 65 Z"
        fill="currentColor"
      />
      <rect x="222" y="378" width="70" height="70" rx="8" fill="currentColor" />
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
  xs: { box: "h-5 w-5 rounded-[5px]", icon: 14 },
  sm: { box: "h-7 w-7 rounded-[6px]", icon: 18 },
  md: { box: "h-9 w-9 rounded-[7px]", icon: 22 },
  lg: { box: "h-10 w-10 rounded-[8px]", icon: 24 },
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
