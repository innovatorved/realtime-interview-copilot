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
  Rows3,
  Download,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { authClient } from "@/lib/auth-client";
import { sendGTMEvent } from "@next/third-parties/google";
import { useTab } from "@/components/TabContext";
import { useAppBackdrop } from "@/components/AppBackdropContext";
import { useInterviewContext } from "@/components/InterviewContextProvider";
import { SignalStrip } from "@/components/shell/SignalStrip";
import { UserMenu } from "@/components/shell/UserMenu";
import { WorkspaceTabs } from "@/components/shell/WorkspaceTabs";
import constants from "@/constant.json";

export default function TitleBar() {
  const [isAlwaysOnTop, setIsAlwaysOnTop] = useState(true);
  const [isMaximized, setIsMaximized] = useState(false);
  const [isElectron, setIsElectron] = useState(false);
  const [appVersion, setAppVersion] = useState<string | null>(null);
  const [updateStatus, setUpdateStatus] = useState<string | null>(null);
  const { backdropOpacity, adjustBackdropOpacity } = useAppBackdrop();
  const { data: session } = authClient.useSession();
  const { activeTab, setActiveTab, compactMode, setCompactMode } = useTab();
  const { saveContext } = useInterviewContext();

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
              setUpdateStatus(
                `Downloading update (${Math.round(status.percent)}%)`,
              );
              break;
            case "downloaded":
              setUpdateStatus(
                `Update ${status.version} ready — restart to install`,
              );
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
      window.dispatchEvent(new Event("auth:logout"));
    } catch (error) {
      console.error("Sign out failed", error);
      window.dispatchEvent(new Event("auth:logout"));
    }
  };

  const toggleCompactMode = () => {
    void saveContext().finally(() => setCompactMode(!compactMode));
  };

  if (!isElectron) {
    return null;
  }

  const noDragStyle = { WebkitAppRegion: "no-drag" } as React.CSSProperties;

  return (
    <div
      data-clickable
      data-window-chrome
      className="titlebar-chrome fixed left-0 right-0 top-0 z-50 flex h-8 select-none flex-col"
      style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
    >
      {!compactMode && <SignalStrip activeTab={activeTab} />}
      <div className="flex min-h-0 flex-1 items-center justify-between px-3">
        <div className="flex min-w-0 items-center gap-2">
          <span className="relative flex h-1.5 w-1.5 shrink-0" aria-hidden>
            <span className="absolute inline-flex h-full w-full rounded-full bg-accent/40" />
            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-accent" />
          </span>
          <span className="truncate text-[11px] font-semibold text-text-primary">
            {constants.displayName}
          </span>

          {!compactMode && (
            <WorkspaceTabs
              activeTab={activeTab}
              onTabChange={setActiveTab}
              variant="titlebar"
              style={noDragStyle}
              className="ml-1 hidden md:flex"
            />
          )}
        </div>

        <div className="flex items-center gap-1" style={noDragStyle}>
          {session?.user && (
            <UserMenu
              user={session.user}
              onLogout={() => void handleLogout()}
              variant="titlebar"
              className="mr-1 hidden sm:flex"
            />
          )}

          <div
            className="mr-1 flex items-center gap-0.5 rounded-md border border-border-subtle px-1.5 py-0.5"
            style={{
              backgroundColor: `color-mix(in oklch, var(--surface-raised) ${Math.round(backdropOpacity * 100)}%, transparent)`,
            }}
          >
            <Button
              size="icon"
              variant="ghost"
              className="h-5 w-5"
              onClick={() => handleBackdropChange(-0.1)}
              title="More see-through (background only)"
            >
              <Minus className="h-3 w-3" />
            </Button>
            <span className="min-w-[28px] text-center text-[10px] font-medium text-text-secondary">
              {Math.round(backdropOpacity * 100)}%
            </span>
            <Button
              size="icon"
              variant="ghost"
              className="h-5 w-5"
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
              "h-6 gap-1 px-1.5",
              compactMode && "text-accent-text",
            )}
            onClick={toggleCompactMode}
            title={
              compactMode
                ? "Exit compact mode (full layout)"
                : "Enter compact mode"
            }
          >
            {compactMode ? (
              <>
                <Maximize2 className="h-3 w-3" />
                <span className="text-[10px] font-medium">Full</span>
              </>
            ) : (
              <Rows3 className="h-3 w-3" />
            )}
          </Button>

          <Button
            size="icon"
            variant="ghost"
            className="h-6 w-6"
            onClick={() => void handleCheckForUpdates()}
            title={
              updateStatus ??
              (appVersion
                ? `Check for updates (v${appVersion})`
                : "Check for updates")
            }
          >
            <Download className="h-3 w-3" />
          </Button>

          <Button
            size="icon"
            variant="ghost"
            className={cn("h-6 w-6", isAlwaysOnTop && "text-info")}
            onClick={handleToggleAlwaysOnTop}
            title={
              isAlwaysOnTop ? "Disable always on top" : "Enable always on top"
            }
          >
            {isAlwaysOnTop ? (
              <Pin className="h-3 w-3" />
            ) : (
              <PinOff className="h-3 w-3" />
            )}
          </Button>

          <div className="ml-1 flex items-center gap-0.5">
            <Button
              size="icon"
              variant="ghost"
              className="h-5 w-5"
              onClick={handleMinimize}
              title="Minimize"
            >
              <Minimize2 className="h-3 w-3" />
            </Button>
            <Button
              size="icon"
              variant="ghost"
              className="h-5 w-5"
              onClick={handleMaximize}
              title={isMaximized ? "Restore" : "Maximize"}
            >
              <Maximize2 className="h-3 w-3" />
            </Button>
            <Button
              size="icon"
              variant="ghost"
              className="h-5 w-5 hover:bg-destructive hover:text-accent-foreground"
              onClick={handleClose}
              title="Close"
            >
              <X className="h-3 w-3" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
