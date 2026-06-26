"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerWindowIpc = registerWindowIpc;
exports.attachWindowFocusNotifier = attachWindowFocusNotifier;
const electron_1 = require("electron");
const WINDOW_FOCUS_CHANNEL = "window:focus";
/** Window control IPC. Channel names and payload shapes are intentionally
 *  preserved verbatim — they are consumed by the preload script and any
 *  rename would silently break the renderer. */
function registerWindowIpc(getWindow) {
    electron_1.ipcMain.handle("window-minimize", () => {
        getWindow()?.minimize();
    });
    electron_1.ipcMain.handle("window-maximize", () => {
        const w = getWindow();
        if (w?.isMaximized()) {
            w.unmaximize();
            return false;
        }
        else {
            w?.maximize();
            return true;
        }
    });
    electron_1.ipcMain.handle("window-close", () => {
        getWindow()?.close();
    });
    electron_1.ipcMain.handle("window-always-on-top", (_, flag) => {
        getWindow()?.setAlwaysOnTop(flag);
        return flag;
    });
    electron_1.ipcMain.handle("window-set-size", (_, width, height) => {
        const w = getWindow();
        if (!w)
            return;
        const [currentWidth, currentHeight] = w.getSize();
        const display = electron_1.screen.getDisplayMatching(w.getBounds());
        const maxW = display.workAreaSize.width;
        const maxH = display.workAreaSize.height;
        const clamp = (v, min, max) => Math.max(min, Math.min(max, Math.round(v)));
        const nextW = Number.isFinite(width) && width > 0
            ? clamp(width, 200, maxW)
            : currentWidth;
        const nextH = Number.isFinite(height) && height > 0
            ? clamp(height, 100, maxH)
            : currentHeight;
        if (nextW !== currentWidth || nextH !== currentHeight) {
            w.setSize(nextW, nextH, false);
        }
    });
    electron_1.ipcMain.handle("window-set-resizable", (_, resizable) => {
        const w = getWindow();
        if (!w)
            return false;
        // setResizable on macOS also disables the green "zoom" button which is
        // exactly what we want in compact mode — no drag-edge resize, no zoom.
        w.setResizable(!!resizable);
        return w.isResizable();
    });
    // Used by the compact overlay to make most of its (transparent) surface
    // click-through so the user can click the app behind. The renderer
    // tracks mouse position over interactive regions (toolbar/drawers) and
    // flips this back to false when the cursor enters them. `forward: true`
    // keeps mousemove events flowing into the renderer even while ignored,
    // which is what lets that tracking work.
    electron_1.ipcMain.handle("window-set-ignore-mouse-events", (_, ignore, options) => {
        const w = getWindow();
        if (!w)
            return;
        try {
            w.setIgnoreMouseEvents(!!ignore, options ?? undefined);
        }
        catch {
            /* destroyed mid-call — ignore */
        }
    });
    electron_1.ipcMain.handle("window-is-always-on-top", () => {
        return getWindow()?.isAlwaysOnTop() || false;
    });
    electron_1.ipcMain.handle("window-is-maximized", () => {
        return getWindow()?.isMaximized() || false;
    });
    electron_1.ipcMain.handle("window-focus", () => {
        const w = getWindow();
        if (!w)
            return;
        if (!w.isVisible())
            w.show();
        w.focus();
    });
}
/** Notify renderer when the OS window gains focus (alt-tab back, etc.). */
function attachWindowFocusNotifier(window) {
    const notify = () => {
        if (!window.isDestroyed()) {
            window.webContents.send(WINDOW_FOCUS_CHANNEL);
        }
    };
    window.on("focus", notify);
}
