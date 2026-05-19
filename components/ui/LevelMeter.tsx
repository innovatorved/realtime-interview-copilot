"use client";

import { cn } from "@/lib/utils";

interface LevelMeterProps {
  /**
   * Normalised input level in [0, 1] from `useAskMic().level`. The meter
   * renders a small fixed number of vertical bars that light up in
   * sequence, so the user has visible proof their mic is picking up audio.
   */
  level: number;
  /**
   * Number of bars to render. Default 4 — enough to read "is anything
   * happening?" at a glance without competing with the icon next to it.
   */
  bars?: number;
  /** Tailwind colour for active bars. Defaults to a soft red for "recording". */
  activeClassName?: string;
  /** Tailwind colour for inactive bars. */
  inactiveClassName?: string;
  className?: string;
}

/**
 * Minimal audio-level indicator for the press-and-hold mic UX. The meter
 * is the single best "is the mic actually working?" signal we can give
 * the user — without it, a silently denied OS-level mic permission is
 * indistinguishable from the user just not speaking yet.
 *
 * Visual: N tiny vertical bars stacked horizontally. Bar i lights up
 * once the level crosses `(i + 1) / N`. Subtle, fits inside a button.
 */
export function LevelMeter({
  level,
  bars = 4,
  activeClassName = "bg-red-400",
  inactiveClassName = "bg-white/15",
  className,
}: LevelMeterProps) {
  // Clamp incoming level so a stale value from a previous session never
  // pegs the meter at 100% after teardown.
  const clamped = Math.max(0, Math.min(1, level));
  return (
    <span
      aria-hidden="true"
      className={cn("inline-flex items-end gap-[1.5px] h-3", className)}
    >
      {Array.from({ length: bars }).map((_, i) => {
        const threshold = (i + 1) / bars;
        const active = clamped >= threshold * 0.4; // light up earlier than threshold so quiet speech still registers
        // Bars grow in height left-to-right for a tiny equaliser look.
        const heightPct = 30 + Math.round((i / Math.max(1, bars - 1)) * 70);
        return (
          <span
            // biome-ignore lint/suspicious/noArrayIndexKey: bars is a fixed small tuple; positional index IS the stable identity
            key={i}
            className={cn(
              "w-[2px] rounded-sm transition-colors duration-75",
              active ? activeClassName : inactiveClassName,
            )}
            style={{ height: `${heightPct}%` }}
          />
        );
      })}
    </span>
  );
}

export default LevelMeter;
