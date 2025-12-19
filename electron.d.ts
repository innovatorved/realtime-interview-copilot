// Global type definitions for Electron API
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
  windowOpenAssistant: () => Promise<void>;
  syncCompletion: (text: string, isNew: boolean) => Promise<void>;
  onSyncCompletion: (
    callback: (text: string, isNew: boolean) => void,
  ) => () => void;
  syncContext: (text: string) => Promise<void>;
  onSyncContext: (callback: (text: string) => void) => () => void;
  appQuit: () => Promise<void>;
  getAudioDevices: () => Promise<{ success: boolean; error?: any }>;
  platform: string;
  isElectron: boolean;
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}

export {};
