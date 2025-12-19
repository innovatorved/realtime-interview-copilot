import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("electronAPI", {
  windowMinimize: () => ipcRenderer.invoke("window-minimize"),
  windowMaximize: () => ipcRenderer.invoke("window-maximize"),
  windowClose: () => ipcRenderer.invoke("window-close"),
  windowAlwaysOnTop: (flag: boolean) =>
    ipcRenderer.invoke("window-always-on-top", flag),
  windowSetOpacity: (opacity: number) =>
    ipcRenderer.invoke("window-set-opacity", opacity),
  windowGetOpacity: () => ipcRenderer.invoke("window-get-opacity"),
  windowIsAlwaysOnTop: () => ipcRenderer.invoke("window-is-always-on-top"),
  windowIsMaximized: () => ipcRenderer.invoke("window-is-maximized"),
  windowSetSize: (width: number, height: number) =>
    ipcRenderer.invoke("window-set-size", width, height),
  appQuit: () => ipcRenderer.invoke("app-quit"),
  getAudioDevices: () => ipcRenderer.invoke("get-audio-devices"),
  platform: process.platform,
  isElectron: true,
});

// Type definitions for TypeScript
export interface ElectronAPI {
  windowMinimize: () => Promise<void>;
  windowMaximize: () => Promise<boolean>;
  windowClose: () => Promise<void>;
  windowAlwaysOnTop: (flag: boolean) => Promise<boolean>;
  windowSetOpacity: (opacity: number) => Promise<number>;
  windowGetOpacity: () => Promise<number>;
  windowIsAlwaysOnTop: () => Promise<boolean>;
  windowIsMaximized: () => Promise<boolean>;
  windowSetSize: (width: number, height: number) => Promise<void>;
  appQuit: () => Promise<void>;
  getAudioDevices: () => Promise<{ success: boolean; error?: any }>;
  platform: string;
  isElectron: boolean;
}
