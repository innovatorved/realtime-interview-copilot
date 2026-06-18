"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import {
  Minimize2,
  Maximize2,
  X,
  Pin,
  PinOff,
  Minus,
  Plus,
  LogOut,
  Mic,
  MessageSquare,
  Sparkles,
  Rows3,
  Download,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { authClient } from "@/lib/auth-client";
import { useRouter } from "next/navigation";
import { sendGTMEvent } from "@next/third-parties/google";

import { useTab } from "@/components/TabContext";
import { useAppBackdrop } from "@/components/AppBackdropContext";
import { formatShortcut, Kbd } from "@/components/ui/Kbd";
import {
  sessionDisplayName,
  sessionUserTitle,
} from "@/lib/session-display";

export default function TitleBar() {
  const [isAlwaysOnTop, setIsAlwaysOnTop] = useState(true);
  const [isMaximized, setIsMaximized] = useState(false);
  const [isElectron, setIsElectron] = useState(false);
  const [appVersion, setAppVersion] = useState<string | null>(null);
  const [updateStatus, setUpdateStatus] = useState<string | null>(null);
  const { backdropOpacity, adjustBackdropOpacity } = useAppBackdrop();
  const { data: session } = authClient.useSession();
  const router = useRouter();
  const { activeTab, setActiveTab, compactMode, setCompactMode } = useTab();

  useEffect(() => {
    if (typeof window !== "undefined" && window.electronAPI) {
      setIsElectron(true);
      window.electronAPI.windowIsAlwaysOnTop().then(setIsAlwaysOnTop);
      window.electronAPI.windowIsMaximized().then(setIsMaximized);

      if (window.electronAPI.updaterGetVersion) {
        void window.electronAPI.updaterGetVersion().then(setAppVersion);
      }
      if (window.electronAPI.onUpdaterStatus) {
        const unsubscribe = window.electronAPI.onUpdaterStatus((status) => {
          switch (status.type) {
            case "checking":
              setUpdateStatus("Checking for updates…");
              break;
            case "available":
              setUpdateStatus(`Update ${status.version} available`);
              break;
            case "downloading":
              setUpdateStatus(`Downloading update (${Math.round(status.percent)}%)`);
              break;
            case "downloaded":
              setUpdateStatus(`Update ${status.version} ready — restart to install`);
              break;
            case "not-available":
              setUpdateStatus(`Up to date (${status.version})`);
              break;
            case "error":
              setUpdateStatus("Update check failed");
              break;
            default:
              setUpdateStatus(null);
          }
        });
        return unsubscribe;
      }
    }
  }, []);

  const handleMinimize = async () => {
    if (window.electronAPI) {
      await window.electronAPI.windowMinimize();
    }
  };

  const handleMaximize = async () => {
    if (window.electronAPI) {
      const maximized = await window.electronAPI.windowMaximize();
      setIsMaximized(maximized);
    }
  };

  const handleClose = async () => {
    if (window.electronAPI) {
      await window.electronAPI.windowClose();
    }
  };

  const handleToggleAlwaysOnTop = async () => {
    if (window.electronAPI) {
      const newState = !isAlwaysOnTop;
      await window.electronAPI.windowAlwaysOnTop(newState);
      setIsAlwaysOnTop(newState);
    }
  };

  const handleBackdropChange = (delta: number) => {
    if (window.electronAPI) {
      adjustBackdropOpacity(delta);
    }
  };

  const handleCheckForUpdates = async () => {
    if (!window.electronAPI?.updaterCheck) return;
    setUpdateStatus("Checking for updates…");
    await window.electronAPI.updaterCheck();
  };

  const handleLogout = async () => {
    try {
      await authClient.signOut({
        fetchOptions: {
          onSuccess: () => {
            sendGTMEvent({ event: "logout" });
            window.dispatchEvent(new Event("auth:logout"));
          },
        },
      });
      // Always dispatch in case onSuccess didn't fire (auth client error).
      window.dispatchEvent(new Event("auth:logout"));
    } catch (error) {
      console.error("Sign out failed", error);
      window.dispatchEvent(new Event("auth:logout"));
    }
  };

  // Don't render in browser mode
  if (!isElectron) {
    return null;
  }

  return (
    <div
      data-clickable
      data-window-chrome
      className="fixed top-0 left-0 right-0 h-8 titlebar-chrome z-50 flex items-center justify-between px-3
                    select-none"
      style={
        {
          WebkitAppRegion: "drag",
        } as React.CSSProperties
      }
    >
      <div className="flex min-w-0 items-center gap-3">
        <span className="relative flex h-2 w-2" aria-hidden>
          <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-400/35" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500 ring-2 ring-emerald-500/25" />
        </span>
        <span className="text-xs font-semibold text-white drop-shadow-[0_1px_2px_color-mix(in_oklch,var(--app-shadow)_65%,transparent)]">
          Realtime Interview Copilot
        </span>

        {/* Tab switcher now sits in the left cluster instead of the visual center. */}
        {!compactMode && (
          <div
            className="flex items-center space-x-0.5 rounded-lg border border-white/[0.04] bg-neutral-900/60 p-0.5"
            style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
          >
            {[
              {
                id: "copilot" as const,
                label: "Copilot",
                icon: Mic,
                shortcutKey: "C",
              },
              {
                id: "ask-ai" as const,
                label: "Ask AI",
                icon: MessageSquare,
                shortcutKey: "A",
              },
              {
                id: "presets" as const,
                label: "Presets",
                icon: Sparkles,
                shortcutKey: "P",
              },
            ].map((tab) => {
              const Icon = tab.icon;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  title={`${tab.label} (${formatShortcut(["Alt", tab.shortcutKey])})`}
                  className={cn(
                    "flex items-center gap-1 px-2.5 py-0.5 rounded-md text-[10px] font-medium transition-all duration-200",
                    activeTab === tab.id
                      ? "bg-emerald-600 text-white shadow-sm"
                      : "text-neutral-400 hover:text-white",
                  )}
                >
                  <Icon className="w-3 h-3" />
                  {tab.label}
                  <Kbd
                    keys={["Alt", tab.shortcutKey]}
                    size="xs"
                    className={cn(
                      "ml-0.5 opacity-70",
                      activeTab === tab.id ? "" : "hidden md:inline-flex",
                    )}
                  />
                </button>
              );
            })}
          </div>
        )}
      </div>

      <div
        className="flex items-center space-x-1"
        style={
          {
            WebkitAppRegion: "no-drag",
          } as React.CSSProperties
        }
      >
        {session && (
          <div className="flex max-w-[min(14rem,36vw)] items-center mr-2 min-w-0 gap-1.5">
            <span
              className="truncate text-[10px] font-medium text-[color:var(--app-text)] mr-1.5"
              title={sessionUserTitle(session.user)}
            >
              {sessionDisplayName(session.user)}
            </span>
            <Button
              size="sm"
              variant="ghost"
              className="h-6 w-6 p-0 hover:bg-red-500/20 text-neutral-300 hover:text-red-400"
              onClick={handleLogout}
              title="Sign Out"
            >
              <LogOut className="h-3 w-3" />
            </Button>
          </div>
        )}

        <div
          className="flex items-center space-x-1 mr-2 rounded px-2 py-1 border border-[color:var(--app-border)] backdrop-blur-sm"
          style={{
            backgroundColor: `rgba(9, 9, 11, ${backdropOpacity * 0.55})`,
          }}
        >
          <Button
            size="sm"
            variant="ghost"
            className="h-6 w-6 p-0 hover:bg-neutral-700/50 text-neutral-200 hover:text-white"
            onClick={() => handleBackdropChange(-0.1)}
            title="More see-through (background only)"
          >
            <Minus className="h-3 w-3" />
          </Button>
          <span className="text-[10px] text-neutral-200 min-w-[32px] text-center font-medium drop-shadow-[0_1px_2px_color-mix(in_oklch,var(--app-shadow)_65%,transparent)]">
            {Math.round(backdropOpacity * 100)}%
          </span>
          <Button
            size="sm"
            variant="ghost"
            className="h-6 w-6 p-0 hover:bg-neutral-700/50 text-neutral-200 hover:text-white"
            onClick={() => handleBackdropChange(0.1)}
            title="Darker background (UI stays sharp)"
          >
            <Plus className="h-3 w-3" />
          </Button>
        </div>

        <Button
          size="sm"
          variant="ghost"
          className={cn(
            "h-7 w-7 p-0 hover:bg-neutral-700/50",
            compactMode
              ? "text-emerald-400 hover:text-emerald-300"
              : "text-neutral-300 hover:text-neutral-200",
          )}
          onClick={() => setCompactMode(!compactMode)}
          title={compactMode ? "Exit compact mode" : "Enter compact mode"}
        >
          <Rows3 className="h-3.5 w-3.5" />
        </Button>

        <Button
          size="sm"
          variant="ghost"
          className="h-7 w-7 p-0 hover:bg-neutral-700/50 text-neutral-300 hover:text-neutral-200"
          onClick={() => void handleCheckForUpdates()}
          title={
            updateStatus ??
            (appVersion ? `Check for updates (v${appVersion})` : "Check for updates")
          }
        >
          <Download className="h-3.5 w-3.5" />
        </Button>

        <Button
          size="sm"
          variant="ghost"
          className={cn(
            "h-7 w-7 p-0 hover:bg-neutral-700/50",
            isAlwaysOnTop
              ? "text-blue-400 hover:text-blue-300"
              : "text-neutral-300 hover:text-neutral-200",
          )}
          onClick={handleToggleAlwaysOnTop}
          title={
            isAlwaysOnTop ? "Disable always on top" : "Enable always on top"
          }
        >
          {isAlwaysOnTop ? (
            <Pin className="h-3.5 w-3.5" />
          ) : (
            <PinOff className="h-3.5 w-3.5" />
          )}
        </Button>

        <div className="flex items-center space-x-1 ml-2">
          <Button
            size="sm"
            variant="ghost"
            className="h-6 w-6 p-0 hover:bg-neutral-700/50 text-neutral-200 hover:text-white"
            onClick={handleMinimize}
            title="Minimize"
          >
            <Minimize2 className="h-3 w-3" />
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-6 w-6 p-0 hover:bg-neutral-700/50 text-neutral-200 hover:text-white"
            onClick={handleMaximize}
            title={isMaximized ? "Restore" : "Maximize"}
          >
            <Maximize2 className="h-3 w-3" />
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-6 w-6 p-0 hover:bg-red-600/80 text-neutral-200 hover:text-white"
            onClick={handleClose}
            title="Close"
          >
            <X className="h-3 w-3" />
          </Button>
        </div>
      </div>
    </div>
  );
}
