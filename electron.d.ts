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

type UpdaterStatusPayload =
  | { type: "idle" }
  | { type: "checking" }
  | { type: "available"; version: string }
  | { type: "not-available"; version: string }
  | { type: "downloading"; percent: number }
  | { type: "downloaded"; version: string }
  | { type: "error"; message: string };

export interface ElectronAPI {
  windowMinimize: () => Promise<void>;
  windowMaximize: () => Promise<boolean>;
  windowClose: () => Promise<void>;
  windowAlwaysOnTop: (flag: boolean) => Promise<boolean>;
  windowIsAlwaysOnTop: () => Promise<boolean>;
  windowIsMaximized: () => Promise<boolean>;
  windowSetSize: (width: number, height: number) => Promise<void>;
  windowSetResizable: (resizable: boolean) => Promise<boolean>;
  /**
   * Toggle Electron's `setIgnoreMouseEvents` so the (mostly transparent)
   * compact overlay can pass clicks through to the app behind. Pass
   * `{ forward: true }` so mousemove events still reach the renderer,
   * which is what lets it detect the cursor entering an interactive
   * region and flip back to non-ignored.
   */
  windowSetIgnoreMouseEvents?: (
    ignore: boolean,
    options?: { forward?: boolean },
  ) => Promise<void>;
  windowFocus?: () => Promise<void>;
  onWindowFocus?: (callback: () => void) => () => void;
  appQuit: () => Promise<void>;
  appRelaunch: () => Promise<void>;
  updaterGetVersion?: () => Promise<string>;
  updaterGetStatus?: () => Promise<UpdaterStatusPayload>;
  updaterCheck?: () => Promise<void>;
  onUpdaterStatus?: (
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

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}

export {};
