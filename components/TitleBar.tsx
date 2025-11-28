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
} from "lucide-react";
import { cn } from "@/lib/utils";
import { authClient } from "@/lib/auth-client";
import { useRouter } from "next/navigation";

export default function TitleBar() {
  const [isAlwaysOnTop, setIsAlwaysOnTop] = useState(true);
  const [opacity, setOpacity] = useState(1);
  const [isMaximized, setIsMaximized] = useState(false);
  const [isElectron, setIsElectron] = useState(false);
  const { data: session } = authClient.useSession();
  const router = useRouter();

  useEffect(() => {
    // Check if running in Electron
    if (typeof window !== "undefined" && window.electronAPI) {
      setIsElectron(true);

      // Get initial states
      window.electronAPI.windowIsAlwaysOnTop().then(setIsAlwaysOnTop);
      window.electronAPI.windowGetOpacity().then(setOpacity);
      window.electronAPI.windowIsMaximized().then(setIsMaximized);
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

  const handleOpacityChange = async (delta: number) => {
    if (window.electronAPI) {
      const newOpacity = Math.max(0.1, Math.min(1, opacity + delta));
      const actualOpacity =
        await window.electronAPI.windowSetOpacity(newOpacity);
      setOpacity(actualOpacity);
    }
  };

  const handleLogout = async () => {
    await authClient.signOut({
      fetchOptions: {
        onSuccess: () => {
          router.push("/login"); // Redirect to login page
        },
      },
    });
  };

  // Don't render in browser mode
  if (!isElectron) {
    return null;
  }

  return (
    <div
      className="fixed top-0 left-0 right-0 h-10 bg-gray-900/30
                    backdrop-blur-md border-b border-gray-700/30 z-50 flex items-center justify-between px-3
                    select-none shadow-lg"
      style={
        {
          WebkitAppRegion: "drag",
        } as React.CSSProperties
      }
    >
      {/* Left side - App title */}
      <div className="flex items-center space-x-2">
        <div className="w-3 h-3 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 animate-pulse" />
        <span className="text-xs font-semibold text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.8)]">
          Realtime Interview Copilot
        </span>
      </div>

      {/* Right side - Controls */}
      <div
        className="flex items-center space-x-1"
        style={
          {
            WebkitAppRegion: "no-drag",
          } as React.CSSProperties
        }
      >
        {/* Logout Button - Only show if logged in */}
        {session && (
          <div className="flex items-center mr-2">
            <span className="text-xs text-gray-400 mr-2 font-medium">
              {session.user.name}
            </span>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 w-7 p-0 hover:bg-red-500/20 text-gray-300 hover:text-red-400"
              onClick={handleLogout}
              title="Sign Out"
            >
              <LogOut className="h-3.5 w-3.5" />
            </Button>
          </div>
        )}

        {/* Opacity controls */}
        <div className="flex items-center space-x-1 mr-2 bg-gray-800/40 backdrop-blur-sm rounded px-2 py-1 border border-gray-700/30">
          <Button
            size="sm"
            variant="ghost"
            className="h-6 w-6 p-0 hover:bg-gray-700/50 text-gray-200 hover:text-white"
            onClick={() => handleOpacityChange(-0.1)}
            title="Decrease transparency"
          >
            <Minus className="h-3 w-3" />
          </Button>
          <span className="text-[10px] text-gray-200 min-w-[32px] text-center font-medium drop-shadow-[0_1px_2px_rgba(0,0,0,0.8)]">
            {Math.round(opacity * 100)}%
          </span>
          <Button
            size="sm"
            variant="ghost"
            className="h-6 w-6 p-0 hover:bg-gray-700/50 text-gray-200 hover:text-white"
            onClick={() => handleOpacityChange(0.1)}
            title="Increase transparency"
          >
            <Plus className="h-3 w-3" />
          </Button>
        </div>

        {/* Always on top toggle */}
        <Button
          size="sm"
          variant="ghost"
          className={cn(
            "h-7 w-7 p-0 hover:bg-gray-700/50",
            isAlwaysOnTop
              ? "text-blue-400 hover:text-blue-300"
              : "text-gray-300 hover:text-gray-200",
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

        {/* Window controls */}
        <div className="flex items-center space-x-1 ml-2">
          <Button
            size="sm"
            variant="ghost"
            className="h-7 w-7 p-0 hover:bg-gray-700/50 text-gray-200 hover:text-white"
            onClick={handleMinimize}
            title="Minimize"
          >
            <Minimize2 className="h-3.5 w-3.5" />
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 w-7 p-0 hover:bg-gray-700/50 text-gray-200 hover:text-white"
            onClick={handleMaximize}
            title={isMaximized ? "Restore" : "Maximize"}
          >
            <Maximize2 className="h-3.5 w-3.5" />
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 w-7 p-0 hover:bg-red-600/80 text-gray-200 hover:text-white"
            onClick={handleClose}
            title="Close"
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
    </div>
  );
}
