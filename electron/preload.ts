import { contextBridge, ipcRenderer } from "electron";

type ScreenAccessStatus =
  | "not-determined"
  | "granted"
  | "denied"
  | "restricted"
  | "unknown";

type ScreenCaptureResult =
  | { success: true; dataUrl: string }
  | { success: false; error: string };

type UpdaterStatusPayload =
  | { type: "idle" }
  | { type: "checking" }
  | { type: "available"; version: string }
  | { type: "not-available"; version: string }
  | { type: "downloading"; percent: number }
  | { type: "downloaded"; version: string }
  | { type: "error"; message: string };

contextBridge.exposeInMainWorld("electronAPI", {
  windowMinimize: () => ipcRenderer.invoke("window-minimize"),
  windowMaximize: () => ipcRenderer.invoke("window-maximize"),
  windowClose: () => ipcRenderer.invoke("window-close"),
  windowAlwaysOnTop: (flag: boolean) =>
    ipcRenderer.invoke("window-always-on-top", flag),
  windowIsAlwaysOnTop: () => ipcRenderer.invoke("window-is-always-on-top"),
  windowIsMaximized: () => ipcRenderer.invoke("window-is-maximized"),
  windowSetSize: (width: number, height: number) =>
    ipcRenderer.invoke("window-set-size", width, height),
  windowSetResizable: (resizable: boolean) =>
    ipcRenderer.invoke("window-set-resizable", resizable),
  windowSetIgnoreMouseEvents: (
    ignore: boolean,
    options?: { forward?: boolean },
  ) => ipcRenderer.invoke("window-set-ignore-mouse-events", ignore, options),
  windowFocus: () => ipcRenderer.invoke("window-focus"),
  windowSetFocusable: (focusable: boolean) =>
    ipcRenderer.invoke("window-set-focusable", focusable),
  onWindowFocus: (callback: () => void) => {
    const handler = () => callback();
    ipcRenderer.on("window:focus", handler);
    return () => ipcRenderer.removeListener("window:focus", handler);
  },
  appRelaunch: () => ipcRenderer.invoke("app-relaunch"),
  openExternal: (url: string): Promise<boolean> =>
    ipcRenderer.invoke("app:open-external", url),
  onAuthCallback: (
    callback: (payload: {
      ticket?: string | null;
      error?: string | null;
    }) => void,
  ) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      payload: { ticket?: string | null; error?: string | null },
    ) => callback(payload);
    ipcRenderer.on("auth:deep-link-callback", handler);
    return () =>
      ipcRenderer.removeListener("auth:deep-link-callback", handler);
  },
  updaterGetVersion: () => ipcRenderer.invoke("updater:get-version"),
  updaterCheck: () => ipcRenderer.invoke("updater:check"),
  updaterInstall: () => ipcRenderer.invoke("updater:install"),
  onUpdaterStatus: (callback: (status: UpdaterStatusPayload) => void) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      status: UpdaterStatusPayload,
    ) => callback(status);
    ipcRenderer.on("updater:status", handler);
    return () => ipcRenderer.removeListener("updater:status", handler);
  },
  platform: process.platform,
  screen: {
    getAccess: (): Promise<ScreenAccessStatus> =>
      ipcRenderer.invoke("screen:get-access"),
    openSettings: (): Promise<boolean> =>
      ipcRenderer.invoke("screen:open-settings"),
    triggerPrompt: (): Promise<ScreenAccessStatus> =>
      ipcRenderer.invoke("screen:trigger-prompt"),
    capture: (): Promise<ScreenCaptureResult> =>
      ipcRenderer.invoke("screen:capture"),
    onCaptureAndAsk: (callback: () => void) => {
      const handler = () => callback();
      ipcRenderer.on("screen:capture-and-ask", handler);
      return () =>
        ipcRenderer.removeListener("screen:capture-and-ask", handler);
    },
  },
});
