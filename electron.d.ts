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
