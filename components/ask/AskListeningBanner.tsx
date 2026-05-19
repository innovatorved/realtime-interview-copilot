"use client";

/** Shared "Listening…" banner shown while the mic is fetching a key,
 *  connecting, or actively recording.
 *
 *  Same content across QuestionAssistant and CompactCopilot's
 *  AskDrawer — only the chrome differs (full surface gets a larger
 *  pulsing dot + 6 meter bars, compact gets 5). Picking via the
 *  `density` prop keeps both call sites byte-identical to the
 *  pre-extraction markup. */

import type { useAskMic } from "@/hooks/useAskMic";
import type { useMicPushToTalk } from "@/hooks/useMicPushToTalk";
import { LevelMeter } from "@/components/ui/LevelMeter";

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

  if (density === "compact") {
    return (
      <div className="flex items-center gap-2 px-2 py-1 rounded-md bg-red-500/[0.08] border border-red-500/20">
        <span className="relative flex h-1.5 w-1.5 shrink-0">
          <span className="absolute inset-0 inline-flex h-full w-full rounded-full bg-red-400 opacity-75 animate-ping" />
          <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-red-500" />
        </span>
        <span className="text-[10px] font-medium text-red-200">
          {askMic.state === "recording"
            ? ptt.isTapLocked
              ? "Listening… tap mic or Space again to send"
              : "Listening… release to send"
            : askMic.state === "connecting"
              ? "Connecting…"
              : "Requesting mic…"}
        </span>
        {askMic.state === "recording" && (
          <LevelMeter
            level={askMic.level}
            bars={5}
            activeClassName="bg-red-300"
            inactiveClassName="bg-red-500/15"
            className="h-3"
          />
        )}
        <span className="ml-auto text-[9px] text-red-300/70 truncate max-w-[40%]">
          {askMic.transcript || "say something…"}
        </span>
      </div>
    );
  }

  return (
    <div className="mb-2 flex items-center gap-2 px-3 py-1.5 rounded-lg bg-red-500/[0.08] border border-red-500/20 animate-fade-in-scale">
      <span className="relative flex h-2 w-2 shrink-0">
        <span className="absolute inset-0 inline-flex h-full w-full rounded-full bg-red-400 opacity-75 animate-ping" />
        <span className="relative inline-flex h-2 w-2 rounded-full bg-red-500" />
      </span>
      <span className="text-[11px] font-medium text-red-200">
        {askMic.state === "recording"
          ? ptt.isTapLocked
            ? "Listening… tap mic or Space again to send"
            : "Listening… release to send"
          : askMic.state === "connecting"
            ? "Connecting…"
            : "Requesting mic…"}
      </span>
      {askMic.state === "recording" && (
        <LevelMeter
          level={askMic.level}
          bars={6}
          activeClassName="bg-red-300"
          inactiveClassName="bg-red-500/15"
          className="h-3"
        />
      )}
      <span className="ml-auto text-[10px] text-red-300/70 truncate max-w-[40%]">
        {askMic.transcript || "say something…"}
      </span>
    </div>
  );
}
