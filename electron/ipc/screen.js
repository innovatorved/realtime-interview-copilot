"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getScreenAccess = getScreenAccess;
exports.registerScreenIpc = registerScreenIpc;
exports.registerCaptureAndAskShortcut = registerCaptureAndAskShortcut;
const electron_1 = require("electron");
const MAX_CAPTURE_EDGE = 1920;
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
            await electron_1.shell.openExternal("ms-settings:sound");
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
            const w = getWindow();
            const targetDisplay = w
                ? electron_1.screen.getDisplayMatching(w.getBounds())
                : electron_1.screen.getPrimaryDisplay();
            const { width, height } = targetDisplay.size;
            const longEdge = Math.max(width, height, 1);
            const scale = longEdge > MAX_CAPTURE_EDGE ? MAX_CAPTURE_EDGE / longEdge : 1;
            const targetW = Math.max(1, Math.round(width * scale));
            const targetH = Math.max(1, Math.round(height * scale));
            const sources = await electron_1.desktopCapturer.getSources({
                types: ["screen"],
                thumbnailSize: {
                    width: targetW,
                    height: targetH,
                },
            });
            const targetId = String(targetDisplay.id);
            const primary = sources.find((s) => String(s.display_id) === targetId) ??
                sources.find((s) => s.display_id) ??
                sources[0];
            if (!primary || primary.thumbnail.isEmpty()) {
                return { success: false, error: "No screen source available" };
            }
            const jpegBuf = primary.thumbnail.toJPEG(82);
            const dataUrl = `data:image/jpeg;base64,${jpegBuf.toString("base64")}`;
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
