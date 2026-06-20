"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  ShieldCheck,
  MonitorSmartphone,
  ExternalLink,
  Sparkles,
  RefreshCw,
  X,
  CheckCircle2,
  RotateCcw,
} from "lucide-react";
import { useTab } from "@/components/TabContext";

const LS_DISMISSED_KEY = "screen-onboard-dismissed-v1";

type Status =
  | "not-determined"
  | "granted"
  | "denied"
  | "restricted"
  | "unknown";

const COMPACT_CHIP_TOOLTIP =
  "Screen Recording is only for system audio — open Settings to enable. Ask AI and mic still work without it.";

export function ScreenRecordingOnboard() {
  const { compactMode } = useTab();
  const [isElectron, setIsElectron] = useState(false);
  const [isMac, setIsMac] = useState(false);
  const [status, setStatus] = useState<Status | null>(null);
  const [dismissedModal, setDismissedModal] = useState(false);
  const [justGranted, setJustGranted] = useState(false);
  const [showRelaunchHint, setShowRelaunchHint] = useState(false);
  const enableClickedAtRef = useRef<number | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const api = window.electronAPI;
    if (!api) return;
    setIsElectron(true);
    setIsMac(api.platform === "darwin");

    try {
      const dismissed = localStorage.getItem(LS_DISMISSED_KEY) === "1";
      setDismissedModal(dismissed);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    if (!isElectron || !isMac) return;
    const api = window.electronAPI;
    if (!api) return;

    let cancelled = false;

    const check = async () => {
      try {
        const next = await api.screen.getAccess();
        if (cancelled) return;
        setStatus((prev) => {
          if (prev && prev !== "granted" && next === "granted") {
            setJustGranted(true);
            setShowRelaunchHint(false);
            setTimeout(() => setJustGranted(false), 2200);
          }
          return next;
        });
        // macOS often caches TCC state until the process relaunches. If
        // the user clicked Enable more than 8s ago and we still aren't
        // seeing granted, surface the relaunch CTA.
        if (
          next !== "granted" &&
          enableClickedAtRef.current &&
          Date.now() - enableClickedAtRef.current > 8000
        ) {
          setShowRelaunchHint(true);
        }
      } catch {
        /* ignore */
      }
    };

    check();
    const interval = setInterval(check, 1200);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [isElectron, isMac]);

  const handleEnable = useCallback(async () => {
    const api = window.electronAPI;
    if (!api) return;
    enableClickedAtRef.current = Date.now();
    // Triggers the native prompt the first time, otherwise no-op, then
    // opens System Settings so the user can toggle / confirm.
    await api.screen.triggerPrompt();
    await api.screen.openSettings();
  }, []);

  const handleRelaunch = useCallback(async () => {
    const api = window.electronAPI;
    if (!api) return;
    try {
      await api.appRelaunch();
    } catch {
      /* ignore */
    }
  }, []);

  const dismiss = useCallback(() => {
    setDismissedModal(true);
    try {
      localStorage.setItem(LS_DISMISSED_KEY, "1");
    } catch {
      /* ignore */
    }
  }, []);

  // Only relevant on macOS Electron builds.
  if (!isElectron || !isMac) return null;
  if (status === null) return null;
  if (status === "granted" && !justGranted) return null;

  const needsAction = status !== "granted";

  if (status === "granted" && justGranted) {
    return (
      <div className="fixed top-14 left-1/2 -translate-x-1/2 z-[100] animate-fade-in-scale">
        <div className="flex items-center gap-2 px-4 py-2.5 rounded-full bg-emerald-500/15 border border-emerald-400/35 backdrop-blur-md shadow-lg shadow-emerald-950/20 text-emerald-300 text-xs font-medium">
          <CheckCircle2 className="w-4 h-4" />
          Screen Recording enabled — you&apos;re all set
        </div>
      </div>
    );
  }

  if (needsAction && compactMode) {
    return (
      <CompactScreenAccessChip
        status={status}
        minimized={dismissedModal}
        showRelaunchHint={showRelaunchHint}
        onEnable={() => void handleEnable()}
        onDismiss={dismiss}
        onRelaunch={() => void handleRelaunch()}
      />
    );
  }

  if (needsAction && !dismissedModal) {
    return (
      <div
        className="fixed inset-0 z-[90] flex items-center justify-center px-4 py-8 animate-fade-in-scale"
        role="dialog"
        aria-modal="true"
        aria-labelledby="sro-title"
      >
        <div className="absolute inset-0 bg-[color:color-mix(in_oklch,var(--app-surface)_82%,transparent)] backdrop-blur-lg" />

        <div className="relative w-full max-w-lg rounded-2xl overflow-hidden border border-[color:var(--app-border)] bg-[color:color-mix(in_oklch,var(--app-surface-elev)_94%,transparent)] backdrop-blur-lg shadow-2xl">
          <button
            type="button"
            onClick={dismiss}
            aria-label="Close"
            className="absolute top-3 right-3 p-1.5 rounded-lg text-[color:var(--app-muted)] hover:text-[color:var(--app-text)] hover:bg-white/[0.05] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--app-ring)]"
          >
            <X className="w-4 h-4" />
          </button>

          <div className="px-7 pt-8 pb-6">
            <div className="flex items-center gap-3 mb-5">
              <div className="w-11 h-11 rounded-2xl bg-emerald-500/10 flex items-center justify-center border border-emerald-500/20">
                <ShieldCheck className="w-5 h-5 text-emerald-400" />
              </div>
              <div>
                <h2
                  id="sro-title"
                  className="text-base font-semibold text-white leading-tight"
                >
                  Enable system audio capture
                </h2>
                <p className="text-[11px] text-[color:var(--app-muted)] mt-0.5">
                  One-time setup • stays invisible on screen share
                </p>
              </div>
            </div>

            <p className="text-sm text-neutral-300 leading-relaxed mb-5">
              To hear the interviewer&apos;s voice from your speakers, macOS
              needs you to grant{" "}
              <span className="text-white font-medium">Screen Recording</span>{" "}
              permission. We only use it to tap system audio — we never upload
              or view your screen.
            </p>

            <ol className="space-y-2.5 mb-6">
              {[
                {
                  icon: Sparkles,
                  title: "Click Enable below",
                  body: "We open System Settings directly to the right page.",
                },
                {
                  icon: MonitorSmartphone,
                  title: "Toggle the switch next to this app",
                  body: "macOS may ask to quit & reopen — say yes.",
                },
                {
                  icon: RefreshCw,
                  title: "Come back here",
                  body: "This window auto-detects access and disappears.",
                },
              ].map((step, i) => {
                const Icon = step.icon;
                return (
                  <li
                    key={i}
                    className="flex items-start gap-3 px-3 py-2.5 rounded-xl bg-[color:color-mix(in_oklch,var(--app-surface)_38%,transparent)] border border-[color:var(--app-border)]"
                  >
                    <div className="shrink-0 w-7 h-7 rounded-lg bg-emerald-500/10 border border-emerald-500/15 flex items-center justify-center text-emerald-400 text-[11px] font-semibold">
                      {i + 1}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 text-sm font-medium text-neutral-100">
                        <Icon className="w-3.5 h-3.5 text-neutral-400" />
                        {step.title}
                      </div>
                      <p className="text-xs text-[color:var(--app-muted)] mt-0.5 leading-snug">
                        {step.body}
                      </p>
                    </div>
                  </li>
                );
              })}
            </ol>

            <div className="flex items-center gap-2">
              <Button
                onClick={handleEnable}
                className="flex-1 h-11 font-medium text-sm rounded-lg"
                variant="default"
              >
                <ExternalLink className="w-3.5 h-3.5 mr-1.5" />
                Enable Screen Recording
              </Button>
              <Button
                variant="ghost"
                onClick={dismiss}
                className="h-11 px-4 text-neutral-400 hover:text-neutral-200 text-sm"
              >
                Later
              </Button>
            </div>

            {showRelaunchHint && (
              <div className="mt-4 p-3 rounded-xl bg-sky-500/[0.06] border border-sky-400/25 animate-fade-in-scale">
                <p className="text-xs text-sky-200 leading-relaxed">
                  <span className="font-medium">Already toggled it on?</span>{" "}
                  macOS needs the app to relaunch to pick up the new permission.
                </p>
                <Button
                  onClick={handleRelaunch}
                  className="mt-2.5 h-9 px-3 bg-sky-500/15 hover:bg-sky-500/25 text-sky-100 border border-sky-400/30 text-xs rounded-lg"
                >
                  <RotateCcw className="w-3 h-3 mr-1.5" />
                  Relaunch app
                </Button>
              </div>
            )}

            <div className="mt-4 flex items-center gap-2 text-[10px] text-[color:var(--app-muted)]">
              <StatusDot status={status} />
              <span>
                Current status:{" "}
                <span className="text-[color:color-mix(in_oklch,var(--app-text)_75%,transparent)] font-mono">
                  {status}
                </span>
              </span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (needsAction && dismissedModal) {
    return (
      <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[80] animate-fade-in-scale">
        <button
          type="button"
          onClick={() => setDismissedModal(false)}
          className={cn(
            "flex items-center gap-2 px-3.5 py-2 rounded-full text-xs",
            "bg-sky-500/10 border border-sky-400/30 text-sky-200",
            "backdrop-blur-md shadow-lg hover:bg-sky-500/15 transition-colors",
          )}
        >
          <ShieldCheck className="w-3.5 h-3.5" />
          <span>Screen Recording not enabled — click to fix</span>
        </button>
      </div>
    );
  }

  return null;
}

function CompactScreenAccessChip({
  status,
  minimized,
  showRelaunchHint,
  onEnable,
  onDismiss,
  onRelaunch,
}: {
  status: Status;
  minimized: boolean;
  showRelaunchHint: boolean;
  onEnable: () => void;
  onDismiss: () => void;
  onRelaunch: () => void;
}) {
  const denied = status === "denied" || status === "restricted";
  const chipTone = denied
    ? "bg-red-500/10 border-red-400/30 text-red-200 hover:bg-red-500/15"
    : "bg-sky-500/10 border-sky-400/30 text-sky-200 hover:bg-sky-500/15";

  const tooltip = showRelaunchHint
    ? `${COMPACT_CHIP_TOOLTIP} Already toggled on? Relaunch the app after granting access.`
    : COMPACT_CHIP_TOOLTIP;

  if (minimized) {
    return (
      <div className="fixed top-9 right-2 z-[85] animate-fade-in-scale">
        <button
          type="button"
          data-clickable
          onClick={onEnable}
          title={tooltip}
          aria-label="Open Screen Recording settings"
          className={cn(
            "relative flex h-7 w-7 items-center justify-center rounded-full border backdrop-blur-md shadow-lg transition-colors",
            chipTone,
          )}
        >
          <ShieldCheck className="w-3.5 h-3.5" />
          <StatusDot
            status={status}
            className="absolute -top-0.5 -right-0.5 ring-2 ring-[color:var(--app-surface)]"
          />
        </button>
      </div>
    );
  }

  return (
    <div
      data-clickable
      className="fixed top-9 right-2 z-[85] flex max-w-[min(100vw-1rem,20rem)] items-center gap-0.5 animate-fade-in-scale"
    >
      <button
        type="button"
        onClick={onEnable}
        title={tooltip}
        className={cn(
          "flex min-w-0 items-center gap-1.5 rounded-full border py-1 pl-2 pr-2.5 text-[10px] font-medium backdrop-blur-md shadow-lg transition-colors",
          chipTone,
        )}
      >
        <StatusDot status={status} />
        <ShieldCheck className="w-3 h-3 shrink-0" />
        <span className="truncate">Screen access</span>
      </button>
      {showRelaunchHint && (
        <button
          type="button"
          onClick={onRelaunch}
          title="Relaunch app to pick up Screen Recording permission"
          aria-label="Relaunch app"
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-sky-400/30 bg-sky-500/10 text-sky-200 backdrop-blur-md shadow-lg transition-colors hover:bg-sky-500/15"
        >
          <RotateCcw className="w-3 h-3" />
        </button>
      )}
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Hide screen access reminder"
        title="Hide reminder"
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-[color:var(--app-border)] bg-[color:color-mix(in_oklch,var(--app-surface-elev)_80%,transparent)] text-[color:var(--app-muted)] backdrop-blur-md shadow-lg transition-colors hover:text-[color:var(--app-text)] hover:bg-white/[0.05]"
      >
        <X className="w-3 h-3" />
      </button>
    </div>
  );
}

function StatusDot({
  status,
  className,
}: {
  status: Status;
  className?: string;
}) {
  const color =
    status === "granted"
      ? "bg-emerald-500"
      : status === "denied" || status === "restricted"
        ? "bg-red-500"
        : "bg-sky-500";
  return (
    <span
      className={cn(
        "inline-block w-1.5 h-1.5 rounded-full shrink-0",
        color,
        className,
      )}
      aria-hidden
    />
  );
}
