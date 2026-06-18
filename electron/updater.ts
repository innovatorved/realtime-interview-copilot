import { app, BrowserWindow, dialog, shell } from "electron";
import {
  autoUpdater,
  type ProgressInfo,
  type UpdateInfo,
} from "electron-updater";

export type UpdaterStatus =
  | { type: "idle" }
  | { type: "checking" }
  | { type: "available"; version: string }
  | { type: "not-available"; version: string }
  | { type: "downloading"; percent: number }
  | { type: "downloaded"; version: string }
  | { type: "error"; message: string };

const LATEST_RELEASE_URL =
  "https://github.com/innovatorved/realtime-interview-copilot/releases/latest";

let status: UpdaterStatus = { type: "idle" };
let getMainWindow: () => BrowserWindow | null = () => null;

function broadcastStatus(next: UpdaterStatus): void {
  status = next;
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send("updater:status", next);
    }
  }
}

export function getUpdaterStatus(): UpdaterStatus {
  return status;
}

export function getAppVersion(): string {
  return app.getVersion();
}

export function initAutoUpdater(
  mainWindowGetter: () => BrowserWindow | null,
): void {
  if (!app.isPackaged || process.env.DEV_PORT) return;

  getMainWindow = mainWindowGetter;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on("checking-for-update", () => {
    broadcastStatus({ type: "checking" });
  });

  autoUpdater.on("update-available", (info: UpdateInfo) => {
    broadcastStatus({ type: "available", version: info.version });
  });

  autoUpdater.on("update-not-available", (info: UpdateInfo) => {
    broadcastStatus({ type: "not-available", version: info.version });
  });

  autoUpdater.on("download-progress", (progress: ProgressInfo) => {
    broadcastStatus({ type: "downloading", percent: progress.percent });
  });

  autoUpdater.on("update-downloaded", (info: UpdateInfo) => {
    broadcastStatus({ type: "downloaded", version: info.version });
    const win = getMainWindow();
    const dialogOptions = {
      type: "info" as const,
      title: "Update ready",
      message: `Version ${info.version} has been downloaded.`,
      detail: "Restart the app to apply the update.",
      buttons: ["Restart now", "Later"],
      defaultId: 0,
      cancelId: 1,
    };
    const dialogPromise = win
      ? dialog.showMessageBox(win, dialogOptions)
      : dialog.showMessageBox(dialogOptions);
    void dialogPromise.then(({ response }) => {
        if (response === 0) {
          autoUpdater.quitAndInstall(false, true);
        }
      });
  });

  autoUpdater.on("error", (err: Error) => {
    const msg = err?.message ?? String(err);
    console.error("[updater]", msg);
    broadcastStatus({ type: "error", message: msg });

    if (process.platform === "darwin") {
      const win = getMainWindow();
      const fallbackOptions = {
        type: "warning" as const,
        title: "Auto-update unavailable",
        message: "Download the latest release from GitHub instead.",
        detail:
          "In-app updates require a signed build. Homebrew users can run: brew upgrade --cask realtime-interview-copilot",
        buttons: ["Open GitHub Releases", "Dismiss"],
        defaultId: 0,
        cancelId: 1,
      };
      const fallbackPromise = win
        ? dialog.showMessageBox(win, fallbackOptions)
        : dialog.showMessageBox(fallbackOptions);
      void fallbackPromise.then(({ response }) => {
          if (response === 0) {
            shell.openExternal(LATEST_RELEASE_URL).catch(() => {
              /* best-effort */
            });
          }
        });
    }
  });

  setTimeout(() => {
    void checkForUpdates();
  }, 30_000);
}

export async function checkForUpdates(): Promise<void> {
  if (!app.isPackaged || process.env.DEV_PORT) return;
  try {
    await autoUpdater.checkForUpdates();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[updater] check failed:", msg);
    broadcastStatus({ type: "error", message: msg });
  }
}
