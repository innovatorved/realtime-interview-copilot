"use client";

import { useEffect, useState } from "react";
import type { AskMicState, AskMicStats } from "@/hooks/useAskMic";
import { isDebug } from "@/lib/debug";
import { cn } from "@/lib/utils";

interface AskMicDebugHudProps {
  state: AskMicState;
  level: number;
  stats: AskMicStats;
  error: string | null;
  /**
   * If `true`, the HUD always renders regardless of the global debug
   * flag. Defaults to undefined (auto, follows the global flag).
   */
  forceShow?: boolean;
  className?: string;
}

/**
 * Returns true when the debug HUD should render. Uses the app-wide
 * `isDebug()` gate so the HUD lights up automatically in `next dev`,
 * with `?debug=1`, or when `localStorage.app_debug === "1"`. Reads on
 * mount (client only) to avoid SSR mismatches.
 */
function useDebugVisible(forceShow?: boolean): boolean {
  const [visible, setVisible] = useState<boolean>(!!forceShow);
  useEffect(() => {
    if (forceShow) {
      setVisible(true);
      return;
    }
    setVisible(isDebug());
  }, [forceShow]);
  return visible;
}

/**
 * On-screen pipeline diagnostics for the Ask AI mic. Renders a tiny
 * monospaced strip with the values that distinguish "mic working but
 * Deepgram silent" from "mic dead" from "no permission":
 *
 *   state · mime · 🎙 lvl · 📤 chunks/bytes · 📝 transcript/final/caption · ⏱ first-caption
 *
 * Visibility rules:
 *   - dev build: always shown
 *   - prod build: only if `?askmic_debug=1` OR `localStorage.askmic_debug=1`
 *   - or pass `forceShow` to override
 *
 * This is the answer to "I am speaking but I can't see anything" — the
 * numbers tell you exactly which stage is broken without DevTools.
 */
export function AskMicDebugHud({
  state,
  level,
  stats,
  error,
  forceShow,
  className,
}: AskMicDebugHudProps) {
  const visible = useDebugVisible(forceShow);
  if (!visible) return null;

  // Colour-code state so a glance is enough to know "are we live".
  const stateColor =
    state === "recording"
      ? "text-red-300"
      : state === "connecting" || state === "fetching-key"
        ? "text-sky-300"
        : state === "stopping"
          ? "text-neutral-300"
          : "text-neutral-500";

  // Tier colours for "are bytes flowing" / "is Deepgram replying" so a
  // user can spot the broken stage in <1s. Zero = red, non-zero = green.
  const txColor = stats.chunksSent > 0 ? "text-emerald-300" : "text-red-300";
  const rxColor =
    stats.transcriptEvents > 0 ? "text-emerald-300" : "text-red-300";
  const capColor =
    stats.captionedEvents > 0 ? "text-emerald-300" : "text-sky-300";

  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        "mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 px-2.5 py-1.5 rounded-md border border-[color:var(--app-border)] bg-[color:color-mix(in_oklch,var(--app-surface)_82%,transparent)] text-[10px] font-mono text-[color:color-mix(in_oklch,var(--app-text)_82%,transparent)] select-none",
        className,
      )}
    >
      <span className={cn("font-semibold uppercase tracking-wide", stateColor)}>
        {state}
      </span>

      {stats.mimeType && (
        <span className="text-neutral-500">
          mime <span className="text-neutral-300">{stats.mimeType}</span>
        </span>
      )}

      <span>
        🎙 <span className="text-neutral-300">{(level * 100).toFixed(0)}%</span>
      </span>

      <span className={txColor}>
        📤 {stats.chunksSent} chunks · {formatBytes(stats.bytesSent)}
      </span>

      <span className={rxColor}>
        📝 {stats.transcriptEvents} events · {stats.finalEvents} final
      </span>

      <span className={capColor}>
        💬 <span>{stats.captionedEvents}</span> captioned
      </span>

      {stats.firstCaptionMs !== null && (
        <span>
          ⏱ <span className="text-neutral-300">{stats.firstCaptionMs}ms</span>
        </span>
      )}

      {stats.lastCaption && (
        <span className="text-neutral-400 truncate max-w-[40ch]">
          “{stats.lastCaption}”
        </span>
      )}

      {error && (
        <span className="basis-full text-red-300/90 break-words">{error}</span>
      )}

      {/* One-line diagnostic legend the user can rely on without docs:
            chunks > 0 but events = 0  → mic→WS OK, Deepgram silent
            chunks = 0 entirely        → MediaRecorder/permission broken
            captioned = 0 but events>0 → Deepgram heard nothing meaningful */}
      {state === "recording" &&
        stats.chunksSent > 0 &&
        stats.transcriptEvents === 0 && (
          <span className="basis-full text-sky-300/90">
            ⚠ audio is being sent but Deepgram returned zero transcript events —
            likely an invalid mimeType for the chosen model.
          </span>
        )}
      {state === "recording" && stats.chunksSent === 0 && (
        <span className="basis-full text-sky-300/90">
          ⚠ no audio chunks emitted — MediaRecorder is silent. Check OS mic
          permission and that the right input device is selected.
        </span>
      )}
    </div>
  );
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n}B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)}KB`;
  return `${(n / (1024 * 1024)).toFixed(1)}MB`;
}

export default AskMicDebugHud;
