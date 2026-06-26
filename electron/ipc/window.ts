import { BrowserWindow, ipcMain, screen } from "electron";

const WINDOW_FOCUS_CHANNEL = "window:focus";

type WindowAccessor = () => BrowserWindow | null;

/** Window control IPC. Channel names and payload shapes are intentionally
 *  preserved verbatim — they are consumed by the preload script and any
 *  rename would silently break the renderer. */
export function registerWindowIpc(getWindow: WindowAccessor): void {
  ipcMain.handle("window-minimize", () => {
    getWindow()?.minimize();
  });

  ipcMain.handle("window-maximize", () => {
    const w = getWindow();
    if (w?.isMaximized()) {
      w.unmaximize();
      return false;
    } else {
      w?.maximize();
      return true;
    }
  });

  ipcMain.handle("window-close", () => {
    getWindow()?.close();
  });

  ipcMain.handle("window-always-on-top", (_, flag: boolean) => {
    getWindow()?.setAlwaysOnTop(flag);
    return flag;
  });

  ipcMain.handle("window-set-size", (_, width: number, height: number) => {
    const w = getWindow();
    if (!w) return;
    const [currentWidth, currentHeight] = w.getSize();
    const display = screen.getDisplayMatching(w.getBounds());
    const maxW = display.workAreaSize.width;
    const maxH = display.workAreaSize.height;
    const clamp = (v: number, min: number, max: number) =>
      Math.max(min, Math.min(max, Math.round(v)));
    const nextW =
      Number.isFinite(width) && width > 0
        ? clamp(width, 200, maxW)
        : currentWidth;
    const nextH =
      Number.isFinite(height) && height > 0
        ? clamp(height, 100, maxH)
        : currentHeight;
    if (nextW !== currentWidth || nextH !== currentHeight) {
      w.setSize(nextW, nextH, false);
    }
  });

  ipcMain.handle("window-set-resizable", (_, resizable: boolean) => {
    const w = getWindow();
    if (!w) return false;
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
  ipcMain.handle(
    "window-set-ignore-mouse-events",
    (_, ignore: boolean, options?: { forward?: boolean }) => {
      const w = getWindow();
      if (!w) return;
      try {
        w.setIgnoreMouseEvents(!!ignore, options ?? undefined);
      } catch {
        /* destroyed mid-call — ignore */
      }
    },
  );

  ipcMain.handle("window-is-always-on-top", () => {
    return getWindow()?.isAlwaysOnTop() || false;
  });

  ipcMain.handle("window-is-maximized", () => {
    return getWindow()?.isMaximized() || false;
  });

  ipcMain.handle("window-focus", () => {
    const w = getWindow();
    if (!w) return;
    if (!w.isVisible()) w.show();
    w.focus();
  });
}


/** Notify renderer when the OS window gains focus (alt-tab back, etc.). */
export function attachWindowFocusNotifier(window: BrowserWindow): void {
  const notify = () => {
    if (!window.isDestroyed()) {
      window.webContents.send(WINDOW_FOCUS_CHANNEL);
    }
  };
  window.on("focus", notify);
}
