"use client";

import { useEffect, useMemo, useState } from "react";
import { useAnnouncements } from "@/hooks/useAnnouncements";
import type { AppAnnouncement, AnnouncementSeverity } from "@/lib/types";
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  Info,
  Megaphone,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";

const POPUP_SEEN_PREFIX = "interview-copilot-popup-seen:";

const SEVERITY_STYLES: Record<
  AnnouncementSeverity,
  { wrap: string; icon: string }
> = {
  info: {
    wrap: "border-sky-500/30 bg-sky-500/10 text-sky-100",
    icon: "text-sky-300",
  },
  success: {
    wrap: "border-emerald-500/30 bg-emerald-500/10 text-emerald-100",
    icon: "text-emerald-300",
  },
  warning: {
    wrap: "border-sky-500/30 bg-sky-500/10 text-sky-100",
    icon: "text-sky-300",
  },
  error: {
    wrap: "border-red-500/30 bg-red-500/10 text-red-100",
    icon: "text-red-300",
  },
  announcement: {
    wrap: "border-emerald-500/25 bg-emerald-500/[0.08] text-emerald-50",
    icon: "text-emerald-300",
  },
};

const SEVERITY_ICONS: Record<AnnouncementSeverity, typeof Info> = {
  info: Info,
  success: CheckCircle2,
  warning: AlertTriangle,
  error: AlertCircle,
  announcement: Megaphone,
};

function isSafeUrl(href: string | null | undefined): href is string {
  if (!href) return false;
  try {
    const u = new URL(href);
    return u.protocol === "https:" || u.protocol === "http:";
  } catch {
    return false;
  }
}

function openExternal(href: string) {
  if (typeof window === "undefined") return;
  window.open(href, "_blank", "noopener,noreferrer");
}

export interface AppAnnouncementsProps {
  /** Hide banners (e.g. in compact electron mode where space is tight). */
  hideBanners?: boolean;
  /** Hide popups (e.g. when another modal is already open). */
  hidePopups?: boolean;
  className?: string;
}

/**
 * Top-level container that renders any active banners and popups for
 * the current user. Drop a single instance near the root of the
 * authenticated app.
 */
export function AppAnnouncements({
  hideBanners,
  hidePopups,
  className,
}: AppAnnouncementsProps) {
  const { banners, popups, dismiss, dismissBannerLocal, ack } =
    useAnnouncements({ enabled: true, pollMs: 60_000 });

  return (
    <div className={className}>
      {!hideBanners &&
        banners.map((b) => (
          <BannerItem
            key={b.id}
            announcement={b}
            onDismiss={() => dismissBannerLocal(b.id)}
            onAck={() => void ack(b.id)}
          />
        ))}
      {!hidePopups && (
        <PopupQueue
          popups={popups}
          onDismiss={(id) => void dismiss(id)}
          onAck={(id) => void ack(id)}
        />
      )}
    </div>
  );
}

function BannerItem({
  announcement,
  onDismiss,
  onAck,
}: {
  announcement: AppAnnouncement;
  onDismiss: () => void;
  onAck: () => void;
}) {
  const styles = SEVERITY_STYLES[announcement.severity] ?? SEVERITY_STYLES.info;
  const Icon = SEVERITY_ICONS[announcement.severity] ?? Info;

  useEffect(() => {
    onAck();
    // Run only once per announcement id; the parent reuses keys so this
    // mounts once per announcement.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [announcement.id]);

  return (
    <div
      role="status"
      className={cn(
        "flex items-start gap-3 rounded-lg border px-3 py-2 text-xs mb-2",
        styles.wrap,
      )}
      data-clickable
    >
      <Icon className={cn("mt-0.5 h-4 w-4 shrink-0", styles.icon)} />
      <div className="flex-1 min-w-0">
        {announcement.title && (
          <p className="font-semibold leading-tight mb-0.5 truncate">
            {announcement.title}
          </p>
        )}
        <p className="leading-snug whitespace-pre-wrap break-words">
          {announcement.body}
        </p>
        {announcement.ctaLabel && isSafeUrl(announcement.ctaUrl) && (
          <button
            type="button"
            className="inline-flex items-center mt-1.5 text-[11px] font-medium underline-offset-2 hover:underline"
            onClick={() => openExternal(announcement.ctaUrl!)}
          >
            {announcement.ctaLabel} →
          </button>
        )}
      </div>
      {announcement.dismissable && (
        <button
          type="button"
          aria-label="Dismiss"
          onClick={onDismiss}
          className="opacity-70 hover:opacity-100 -mr-1 -mt-1 p-1 rounded"
          data-clickable
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}

function PopupQueue({
  popups,
  onDismiss,
  onAck,
}: {
  popups: AppAnnouncement[];
  onDismiss: (id: string) => void;
  onAck: (id: string) => void;
}) {
  // Show one popup at a time so we don't stack modals on top of each
  // other. The user dismisses → we drop to the next one.
  const [seen, setSeen] = useState<Set<string>>(new Set());

  // Hydrate "seen this session" from localStorage so the same popup
  // doesn't reappear immediately if the user opens another window.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const next = new Set<string>();
    for (const p of popups) {
      try {
        if (window.localStorage.getItem(POPUP_SEEN_PREFIX + p.id)) {
          next.add(p.id);
        }
      } catch {
        /* ignore */
      }
    }
    setSeen(next);
  }, [popups]);

  const visible = useMemo(
    () => popups.find((p) => !seen.has(p.id)) ?? null,
    [popups, seen],
  );

  if (!visible) return null;

  const styles = SEVERITY_STYLES[visible.severity] ?? SEVERITY_STYLES.info;
  const Icon = SEVERITY_ICONS[visible.severity] ?? Info;

  const markSeen = (id: string) => {
    try {
      window.localStorage.setItem(POPUP_SEEN_PREFIX + id, "1");
    } catch {
      /* ignore */
    }
    setSeen((prev) => {
      const n = new Set(prev);
      n.add(id);
      return n;
    });
  };

  const handleDismiss = () => {
    markSeen(visible.id);
    onDismiss(visible.id);
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-[120] flex items-center justify-center bg-[color:color-mix(in_oklch,var(--app-surface)_70%,transparent)] backdrop-blur-sm p-4"
      data-clickable
    >
      <div
        className={cn(
          "relative w-full max-w-md rounded-xl border border-[color:var(--app-border)] bg-[color:color-mix(in_oklch,var(--app-surface-elev)_94%,transparent)] backdrop-blur-md shadow-2xl",
          styles.wrap.replace("text-", "ring-").replace("/10", "/30"),
        )}
      >
        <div className="flex items-start gap-3 p-5">
          <div
            className={cn(
              "h-10 w-10 shrink-0 rounded-full flex items-center justify-center",
              styles.wrap,
            )}
          >
            <Icon className={cn("h-5 w-5", styles.icon)} />
          </div>
          <div className="flex-1 min-w-0">
            {visible.title && (
              <h2 className="text-base font-semibold text-white leading-tight mb-1">
                {visible.title}
              </h2>
            )}
            <p className="text-sm text-neutral-200 whitespace-pre-wrap break-words leading-relaxed">
              {visible.body}
            </p>
            {visible.ctaLabel && isSafeUrl(visible.ctaUrl) && (
              <button
                type="button"
                className="mt-3 inline-flex items-center justify-center text-sm font-medium px-3 py-1.5 rounded-md bg-emerald-600 hover:bg-emerald-500 text-white"
                onClick={() => {
                  openExternal(visible.ctaUrl!);
                  onAck(visible.id);
                }}
              >
                {visible.ctaLabel}
              </button>
            )}
          </div>
          {visible.dismissable && (
            <button
              type="button"
              aria-label="Close"
              onClick={handleDismiss}
              className="text-neutral-400 hover:text-white"
              data-clickable
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
        {visible.dismissable && (
          <div className="px-5 pb-4 flex justify-end">
            <button
              type="button"
              className="text-xs font-medium px-3 py-1.5 rounded-md bg-neutral-800 hover:bg-neutral-700 text-neutral-100"
              onClick={handleDismiss}
            >
              Got it
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
