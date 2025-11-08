import { contextBridge, ipcRenderer } from "electron";

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld("electronAPI", {
  // Window controls
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

  // App controls
  appQuit: () => ipcRenderer.invoke("app-quit"),

  // Audio device enumeration
  getAudioDevices: () => ipcRenderer.invoke("get-audio-devices"),

  // Platform info
  platform: process.platform,

  // Check if running in Electron
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
  appQuit: () => Promise<void>;
  getAudioDevices: () => Promise<{ success: boolean; error?: any }>;
  platform: string;
  isElectron: boolean;
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}
