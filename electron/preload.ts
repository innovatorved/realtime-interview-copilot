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
  appQuit: () => ipcRenderer.invoke("app-quit"),
  appRelaunch: () => ipcRenderer.invoke("app-relaunch"),
  // Re-fetch BYOK runtime config and rebuild the renderer CSP. Called
  // after the user saves new BYOK credentials so the next request to
  // their endpoint isn't blocked by the previous CSP.
  refreshCsp: () => ipcRenderer.invoke("byok:refresh-csp"),
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
      return () => ipcRenderer.removeListener("screen:capture-and-ask", handler);
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
  appQuit: () => Promise<void>;
  appRelaunch: () => Promise<void>;
  refreshCsp: () => Promise<{ ok: boolean; hosts?: string[] }>;
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
