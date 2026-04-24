// Global type definitions for Electron API

type ScreenAccessStatus =
  | "not-determined"
  | "granted"
  | "denied"
  | "restricted"
  | "unknown";

type ScreenCaptureResult =
  | { success: true; dataUrl: string }
  | { success: false; error: string };

export interface ElectronAPI {
  windowMinimize: () => Promise<void>;
  windowMaximize: () => Promise<boolean>;
  windowClose: () => Promise<void>;
  windowAlwaysOnTop: (flag: boolean) => Promise<boolean>;
  windowIsAlwaysOnTop: () => Promise<boolean>;
  windowIsMaximized: () => Promise<boolean>;
  windowSetSize: (width: number, height: number) => Promise<void>;
  // Optional because the main process does not currently register these
  // IPC channels. Renderers must feature-detect before calling.
  windowOpenAssistant?: () => Promise<void>;
  syncCompletion?: (text: string, isNew: boolean) => Promise<void>;
  onSyncCompletion?: (
    callback: (text: string, isNew: boolean) => void,
  ) => () => void;
  syncContext?: (text: string) => Promise<void>;
  onSyncContext?: (callback: (text: string) => void) => () => void;
  appQuit: () => Promise<void>;
  appRelaunch: () => Promise<void>;
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

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}

export {};
