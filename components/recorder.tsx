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
import { MicIcon } from "@/components/ui/icon";
import { Loader2, MicOffIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { useTranscription } from "@/components/TranscriptionContext";

interface RecorderTranscriberProps {
  /**
   * Slim icon-sized variant suitable for the compact toolbar.
   */
  compact?: boolean;
  /** Hide status row under the control bar (full Copilot context card). */
  dense?: boolean;
  /** Single-row bar: source label + listen/stop beside sibling controls. */
  inline?: boolean;
}

export default function RecorderTranscriber({
  compact = false,
  dense = false,
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
          "h-7 gap-1.5 px-2.5 text-[11px] font-medium rounded-lg border transition-all",
          sessionState === "live"
            ? "bg-red-500/15 text-red-300 border-red-500/25 hover:bg-red-500/25 animate-pulse"
            : isBusy
              ? "bg-sky-500/10 text-sky-300 border-sky-500/20"
              : "bg-emerald-500/15 text-emerald-300 border-emerald-500/25 hover:bg-emerald-500/25",
        )}
      >
        {isBusy ? (
          <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
        ) : sessionState === "live" ? (
          <MicOffIcon className="h-3 w-3" aria-hidden />
        ) : (
          <MicIcon className="h-3 w-3" aria-hidden />
        )}
        <span className="hidden sm:inline">{label}</span>
      </Button>
    );
  }

  if (inline) {
    const sourceHint = isElectron ? "System audio" : "Tab audio";
    const listenTitle = errorMessage
      ? errorMessage
      : sessionState === "live"
        ? "Stop listening"
        : isBusy
          ? "Starting transcription…"
          : `Start listening (${sourceHint})`;

    return (
      <>
        <Button
          type="button"
          size="sm"
          title={errorMessage ?? listenTitle}
          aria-label={listenTitle}
          onClick={isActive ? stopSession : startSession}
          disabled={isBusy || !isClientReady}
          className={cn(
            "h-8 px-3 text-xs font-medium shrink-0 gap-1.5 rounded-lg whitespace-nowrap",
            sessionState === "live"
              ? "bg-red-500/15 text-red-300 border border-red-500/25 hover:bg-red-500/25"
              : "bg-emerald-500/15 text-emerald-300 border border-emerald-500/25 hover:bg-emerald-500/25",
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
              <MicIcon className="h-3.5 w-3.5 shrink-0" aria-hidden />
              Start Listening
            </>
          )}
        </Button>
      </>
    );
  }

  return (
    <div className="w-full relative">
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center gap-2 p-1 bg-neutral-950/50 rounded-lg border border-white/5 h-9">
          {isBusy ? (
            <div
              className="flex-1 flex items-center justify-center gap-2 text-neutral-400 text-xs"
              role="status"
              aria-live="polite"
            >
              <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-emerald-500/80" />
              <span>
                {sessionState === "fetching-key"
                  ? "Fetching API key…"
                  : isReconnecting
                    ? "Reconnecting…"
                    : "Connecting…"}
              </span>
            </div>
          ) : (
            <div className="flex-1 flex items-center gap-2 px-2 min-w-0">
              <span className="text-neutral-500 text-[10px] uppercase tracking-wider font-semibold shrink-0">
                Source
              </span>
              <span className="text-neutral-300 text-xs truncate">
                {isElectron
                  ? "System audio (loudspeaker)"
                  : "Browser tab / window audio"}
              </span>
            </div>
          )}

          <Button
            className={cn(
              "h-8 px-4 text-xs font-medium transition-all duration-300 shrink-0",
              sessionState === "live"
                ? "bg-red-500/10 text-red-400 hover:bg-red-500/20 hover:text-red-300 border border-red-500/20"
                : "bg-green-500/10 text-green-400 hover:bg-green-500/20 hover:text-green-300 border border-green-500/20",
            )}
            size="sm"
            onClick={isActive ? stopSession : startSession}
            disabled={isBusy || !isClientReady}
          >
            {!isActive ? (
              <div className="flex items-center gap-2">
                <MicIcon className="h-3 w-3" />
                Start Listening
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <MicOffIcon className="h-3 w-3" />
                Stop
              </div>
            )}
          </Button>
        </div>

        {!dense && (
          <div className="flex items-center justify-between px-1 h-4">
            <div className="flex items-center gap-2">
              <div
                className={cn(
                  "w-1.5 h-1.5 rounded-full transition-colors",
                  sessionState === "live"
                    ? "bg-green-500 animate-pulse"
                    : isActive
                      ? "bg-sky-500"
                      : "bg-neutral-700",
                )}
              />
              <span className="text-[10px] text-neutral-500 font-medium uppercase tracking-wider">
                {sessionState === "live"
                  ? "Live & Connected"
                  : isReconnecting
                    ? "Reconnecting"
                    : sessionState === "idle"
                      ? "Ready"
                      : "Connecting..."}
              </span>
            </div>
            {sessionState === "live" && (
              <span className="text-[10px] text-green-500/70 font-mono animate-pulse">
                REC
              </span>
            )}
          </div>
        )}

        {errorMessage && (
          <div
            role="alert"
            className="flex items-start gap-2 px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/25 text-red-200 text-[11px] leading-snug"
          >
            <span className="flex-1">{errorMessage}</span>
          </div>
        )}
      </div>
    </div>
  );
}
