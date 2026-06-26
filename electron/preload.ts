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
  onWindowFocus: (callback: () => void) => {
    const handler = () => callback();
    ipcRenderer.on("window:focus", handler);
    return () => ipcRenderer.removeListener("window:focus", handler);
  },
  appQuit: () => ipcRenderer.invoke("app-quit"),
  appRelaunch: () => ipcRenderer.invoke("app-relaunch"),
  updaterGetVersion: () => ipcRenderer.invoke("updater:get-version"),
  updaterGetStatus: () => ipcRenderer.invoke("updater:get-status"),
  updaterCheck: () => ipcRenderer.invoke("updater:check"),
  onUpdaterStatus: (callback: (status: UpdaterStatusPayload) => void) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      status: UpdaterStatusPayload,
    ) => callback(status);
    ipcRenderer.on("updater:status", handler);
    return () => ipcRenderer.removeListener("updater:status", handler);
  },
  platform: process.platform,
  isElectron: true,
  supportsSystemAudio: true,
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

export interface ElectronAPI {
  windowMinimize: () => Promise<void>;
  windowMaximize: () => Promise<boolean>;
  windowClose: () => Promise<void>;
  windowAlwaysOnTop: (flag: boolean) => Promise<boolean>;
  windowIsAlwaysOnTop: () => Promise<boolean>;
  windowIsMaximized: () => Promise<boolean>;
  windowSetSize: (width: number, height: number) => Promise<void>;
  windowSetResizable: (resizable: boolean) => Promise<boolean>;
  windowSetIgnoreMouseEvents: (
    ignore: boolean,
    options?: { forward?: boolean },
  ) => Promise<void>;
  windowFocus: () => Promise<void>;
  onWindowFocus?: (callback: () => void) => () => void;
  appQuit: () => Promise<void>;
  appRelaunch: () => Promise<void>;
  updaterGetVersion: () => Promise<string>;
  updaterGetStatus: () => Promise<UpdaterStatusPayload>;
  updaterCheck: () => Promise<void>;
  onUpdaterStatus: (
    callback: (status: UpdaterStatusPayload) => void,
  ) => () => void;
  platform: string;
  isElectron: boolean;
  supportsSystemAudio: boolean;
  screen: {
    getAccess: () => Promise<ScreenAccessStatus>;
    openSettings: () => Promise<boolean>;
    triggerPrompt: () => Promise<ScreenAccessStatus>;
    capture: () => Promise<ScreenCaptureResult>;
    onCaptureAndAsk: (callback: () => void) => () => void;
  };
}
