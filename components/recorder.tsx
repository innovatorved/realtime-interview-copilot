"use client";

/**
 * Presentational recorder controls.
 *
 * The Deepgram session, media stream and transcribed text live in
 * `TranscriptionProvider`. This component just renders the buttons /
 * status UI and dispatches start/stop into the provider, so the compact
 * toolbar and the full Copilot are two skins for the same single live
 * session — toggling between them no longer interrupts an active
 * recording.
 */

import { Button } from "@/components/ui/button";
import { Loader2, Mic, MicOffIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { useTranscription } from "@/components/TranscriptionContext";

interface RecorderTranscriberProps {
  /**
   * Slim icon-sized variant suitable for the compact toolbar.
   */
  compact?: boolean;
  /** Single-row bar: source label + listen/stop beside sibling controls. */
  inline?: boolean;
}

export default function RecorderTranscriber({
  compact = false,
  inline = false,
}: RecorderTranscriberProps) {
  const {
    sessionState,
    errorMessage,
    isElectron,
    isClientReady,
    isActive,
    isBusy,
    isReconnecting,
    startSession,
    stopSession,
  } = useTranscription();

  if (compact) {
    // One unified "Starting" state covers both fetching-key and connecting
    // — they're indistinguishable to the user. State machine the user
    // sees: Start → Starting → Stop.
    const label =
      sessionState === "live"
        ? "Stop"
        : isReconnecting
          ? "Reconnecting"
          : isBusy
            ? "Starting"
            : "Start";
    const tooltip = errorMessage
      ? errorMessage
      : isReconnecting
        ? "Reconnecting to transcription service…"
        : sessionState === "live"
          ? "Recording — click to stop"
          : isBusy
            ? "Starting transcription…"
            : "Start transcription";

    return (
      <Button
        type="button"
        size="sm"
        title={tooltip}
        aria-label={tooltip}
        onClick={isActive ? stopSession : startSession}
        disabled={isBusy || !isClientReady}
        className={cn(
          "h-7 gap-1.5 px-2.5 text-[11px] font-semibold rounded-md border transition-all",
          sessionState === "live"
            ? "bg-destructive-muted text-destructive border-destructive/30 hover:bg-destructive/20 animate-pulse"
            : isBusy
              ? "bg-info/10 text-info border-info/25"
              : "bg-accent-muted text-accent-text border-accent/30 hover:bg-accent/20",
        )}
      >
        {isBusy ? (
          <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
        ) : sessionState === "live" ? (
          <MicOffIcon className="h-3 w-3" aria-hidden />
        ) : (
          <Mic className="h-3 w-3" aria-hidden />
        )}
        <span className="hidden sm:inline">{label}</span>
      </Button>
    );
  }

  void inline;
  const sourceHint = isElectron ? "System audio" : "Tab audio";
  const listenTitle = errorMessage
    ? errorMessage
    : sessionState === "live"
      ? "Stop listening"
      : isBusy
        ? "Starting transcription…"
        : `Start listening (${sourceHint})`;

  return (
    <Button
      type="button"
      size="sm"
      title={errorMessage ?? listenTitle}
      aria-label={listenTitle}
      onClick={isActive ? stopSession : startSession}
      disabled={isBusy || !isClientReady}
      className={cn(
        "h-8 px-3 text-xs font-semibold shrink-0 gap-1.5 rounded-md whitespace-nowrap border",
        sessionState === "live"
          ? "bg-destructive-muted text-destructive border-destructive/30 hover:bg-destructive/20"
          : "bg-accent-muted text-accent-text border-accent/30 hover:bg-accent/20",
      )}
    >
      {isBusy ? (
        <>
          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
          Starting…
        </>
      ) : sessionState === "live" ? (
        <>
          <MicOffIcon className="h-3.5 w-3.5 shrink-0" aria-hidden />
          Stop
        </>
      ) : (
        <>
          <Mic className="h-3.5 w-3.5 shrink-0" aria-hidden />
          Start Listening
        </>
      )}
    </Button>
  );
}
