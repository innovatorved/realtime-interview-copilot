"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getScreenAccess = getScreenAccess;
exports.registerScreenIpc = registerScreenIpc;
exports.registerCaptureAndAskShortcut = registerCaptureAndAskShortcut;
const electron_1 = require("electron");
/** macOS gates screen capture behind a TCC permission; everywhere else
 *  capture is unconditionally allowed. We treat lookup failures as
 *  `unknown` so the renderer can still attempt a capture (which will
 *  surface a real OS error if it actually fails). */
function getScreenAccess() {
    if (process.platform !== "darwin")
        return "granted";
    try {
        return electron_1.systemPreferences.getMediaAccessStatus("screen");
    }
    catch {
        return "unknown";
    }
}
/** Register screen-related IPC handlers + the "capture and ask" global
 *  hotkey. Channel names and payload shapes are preserved verbatim. */
function registerScreenIpc(getWindow) {
    // Screen Recording permission + silent snapshot capture for "Ask AI with
    // screenshot". On macOS, a single getSources() call triggers the native
    // permission dialog the first time, then subsequent calls are silent.
    electron_1.ipcMain.handle("screen:get-access", () => getScreenAccess());
    electron_1.ipcMain.handle("screen:open-settings", async () => {
        if (process.platform === "darwin") {
            await electron_1.shell.openExternal("x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture");
            return true;
        }
        if (process.platform === "win32") {
            await electron_1.shell.openExternal("ms-settings:privacy-broadfilesystemaccess");
            return true;
        }
        return false;
    });
    electron_1.ipcMain.handle("screen:trigger-prompt", async () => {
        // Calling getSources() is what causes macOS to display the permission
        // prompt the first time. We discard the result.
        try {
            await electron_1.desktopCapturer.getSources({
                types: ["screen"],
                thumbnailSize: { width: 1, height: 1 },
            });
        }
        catch {
            // Permission denied or not available
        }
        return getScreenAccess();
    });
    electron_1.ipcMain.handle("screen:capture", async () => {
        // Silent full-screen snapshot. Unlike getDisplayMedia() this is a
        // one-shot frame grab; on macOS 13+ it does not engage the continuous
        // recording indicator for longer than the single frame.
        try {
            const { width, height } = electron_1.screen.getPrimaryDisplay().size;
            const scale = 1; // 1:1, full native resolution
            const sources = await electron_1.desktopCapturer.getSources({
                types: ["screen"],
                thumbnailSize: {
                    width: Math.round(width * scale),
                    height: Math.round(height * scale),
                },
            });
            const primary = sources.find((s) => s.display_id) ?? sources[0];
            if (!primary || primary.thumbnail.isEmpty()) {
                return { success: false, error: "No screen source available" };
            }
            // Downscale to keep the payload reasonable for the LLM (max ~1600px long edge)
            const maxLongEdge = 1600;
            const longEdge = Math.max(width, height);
            const img = longEdge > maxLongEdge
                ? primary.thumbnail.resize({
                    width: Math.round(width * (maxLongEdge / longEdge)),
                    height: Math.round(height * (maxLongEdge / longEdge)),
                })
                : primary.thumbnail;
            const dataUrl = img.toDataURL(); // image/png base64
            return { success: true, dataUrl };
        }
        catch (err) {
            return {
                success: false,
                error: err instanceof Error ? err.message : String(err),
            };
        }
    });
}
/** Register the global hotkey that captures the screen and focuses the
 *  Ask AI tab. Works even when another app (Zoom, browser, etc.) has
 *  focus, so the user can trigger from the interview without switching
 *  windows. */
function registerCaptureAndAskShortcut(getWindow) {
    try {
        electron_1.globalShortcut.register("CommandOrControl+Shift+1", () => {
            const w = getWindow();
            if (!w)
                return;
            if (!w.isVisible())
                w.show();
            w.focus();
            w.webContents.send("screen:capture-and-ask");
        });
    }
    catch (err) {
        console.error("Failed to register global shortcut:", err);
    }
}
