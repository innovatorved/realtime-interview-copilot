import {
  BrowserWindow,
  desktopCapturer,
  globalShortcut,
  ipcMain,
  screen,
  shell,
  systemPreferences,
} from "electron";

type WindowAccessor = () => BrowserWindow | null;

export type ScreenAccessStatus =
  | "not-determined"
  | "granted"
  | "denied"
  | "restricted"
  | "unknown";

/** macOS gates screen capture behind a TCC permission; everywhere else
 *  capture is unconditionally allowed. We treat lookup failures as
 *  `unknown` so the renderer can still attempt a capture (which will
 *  surface a real OS error if it actually fails). */
export function getScreenAccess(): ScreenAccessStatus {
  if (process.platform !== "darwin") return "granted";
  try {
    return systemPreferences.getMediaAccessStatus(
      "screen",
    ) as ScreenAccessStatus;
  } catch {
    return "unknown";
  }
}

/** Register screen-related IPC handlers + the "capture and ask" global
 *  hotkey. Channel names and payload shapes are preserved verbatim. */
export function registerScreenIpc(getWindow: WindowAccessor): void {
  // Screen Recording permission + silent snapshot capture for "Ask AI with
  // screenshot". On macOS, a single getSources() call triggers the native
  // permission dialog the first time, then subsequent calls are silent.
  ipcMain.handle("screen:get-access", () => getScreenAccess());

  ipcMain.handle("screen:open-settings", async () => {
    if (process.platform === "darwin") {
      await shell.openExternal(
        "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture",
      );
      return true;
    }
    if (process.platform === "win32") {
      await shell.openExternal("ms-settings:privacy-broadfilesystemaccess");
      return true;
    }
    return false;
  });

  ipcMain.handle("screen:trigger-prompt", async () => {
    // Calling getSources() is what causes macOS to display the permission
    // prompt the first time. We discard the result.
    try {
      await desktopCapturer.getSources({
        types: ["screen"],
        thumbnailSize: { width: 1, height: 1 },
      });
    } catch {
      // Permission denied or not available
    }
    return getScreenAccess();
  });

  ipcMain.handle("screen:capture", async () => {
    // Silent full-screen snapshot. Unlike getDisplayMedia() this is a
    // one-shot frame grab; on macOS 13+ it does not engage the continuous
    // recording indicator for longer than the single frame.
    try {
      const { width, height } = screen.getPrimaryDisplay().size;
      const scale = 1; // 1:1, full native resolution
      const sources = await desktopCapturer.getSources({
        types: ["screen"],
        thumbnailSize: {
          width: Math.round(width * scale),
          height: Math.round(height * scale),
        },
      });

      const primary = sources.find((s) => s.display_id) ?? sources[0];
      if (!primary || primary.thumbnail.isEmpty()) {
        return { success: false as const, error: "No screen source available" };
      }

      // Downscale to keep the payload reasonable for the LLM (max ~1600px long edge)
      const maxLongEdge = 1600;
      const longEdge = Math.max(width, height);
      const img =
        longEdge > maxLongEdge
          ? primary.thumbnail.resize({
              width: Math.round(width * (maxLongEdge / longEdge)),
              height: Math.round(height * (maxLongEdge / longEdge)),
            })
          : primary.thumbnail;

      const dataUrl = img.toDataURL(); // image/png base64
      return { success: true as const, dataUrl };
    } catch (err) {
      return {
        success: false as const,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  });
}

/** Register the global hotkey that captures the screen and focuses the
 *  Ask AI tab. Works even when another app (Zoom, browser, etc.) has
 *  focus, so the user can trigger from the interview without switching
 *  windows. */
export function registerCaptureAndAskShortcut(getWindow: WindowAccessor): void {
  try {
    globalShortcut.register("CommandOrControl+Shift+1", () => {
      const w = getWindow();
      if (!w) return;
      if (!w.isVisible()) w.show();
      w.focus();
      w.webContents.send("screen:capture-and-ask");
    });
  } catch (err) {
    console.error("Failed to register global shortcut:", err);
  }
}
