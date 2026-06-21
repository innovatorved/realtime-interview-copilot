"use client";

import type { useAskMic } from "@/hooks/useAskMic";
import type { useMicPushToTalk } from "@/hooks/useMicPushToTalk";
import { LevelMeter } from "@/components/ui/LevelMeter";
import { cn } from "@/lib/utils";

interface AskListeningBannerProps {
  askMic: ReturnType<typeof useAskMic>;
  ptt: ReturnType<typeof useMicPushToTalk>;
  density: "default" | "compact";
}

export function AskListeningBanner({
  askMic,
  ptt,
  density,
}: AskListeningBannerProps) {
  if (
    askMic.state !== "fetching-key" &&
    askMic.state !== "connecting" &&
    askMic.state !== "recording"
  ) {
    return null;
  }

  const message =
    askMic.state === "recording"
      ? ptt.isTapLocked
        ? "Listening… tap mic or Space again to send"
        : "Listening… release to send"
      : askMic.state === "connecting"
        ? "Connecting…"
        : "Requesting mic…";

  return (
    <div
      className={cn(
        "flex items-center gap-2 rounded-md border border-destructive/25 bg-destructive-muted",
        density === "compact"
          ? "px-2 py-1"
          : "mb-2 px-3 py-1.5 animate-fade-in-scale",
      )}
    >
      <span className="relative flex h-1.5 w-1.5 shrink-0 md:h-2 md:w-2">
        <span className="absolute inline-flex h-full w-full animate-recording-pulse rounded-full bg-destructive opacity-60" />
        <span className="relative inline-flex h-full w-full rounded-full bg-destructive" />
      </span>
      <span
        className={cn(
          "font-medium text-destructive",
          density === "compact" ? "text-[10px]" : "text-[11px]",
        )}
      >
        {message}
      </span>
      {askMic.state === "recording" && (
        <LevelMeter
          level={askMic.level}
          bars={density === "compact" ? 5 : 6}
          activeClassName="bg-destructive"
          inactiveClassName="bg-destructive/20"
          className="h-3"
        />
      )}
      <span
        className={cn(
          "ml-auto max-w-[40%] truncate text-destructive/80",
          density === "compact" ? "text-[9px]" : "text-[10px]",
        )}
      >
        {askMic.transcript || "say something…"}
      </span>
    </div>
  );
}
