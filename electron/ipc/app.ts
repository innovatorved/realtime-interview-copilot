import { app, ipcMain, shell } from "electron";

import {
  checkForUpdates,
  getAppVersion,
  installDownloadedUpdate,
} from "../updater";

const ALLOWED_EXTERNAL_HOSTS = new Set([
  "sso.vedgupta.in",
  "realtime-worker-api-prod.vedgupta.in",
  "copilot.vedgupta.in",
  "localhost",
  "127.0.0.1",
]);

/** App lifecycle IPC: relaunch + updater + safe external URL opener.
 *
 *  Relaunch is needed after macOS Screen Recording permission changes
 *  because TCC state is cached per-process until the next launch. */
export function registerAppIpc(): void {
  ipcMain.handle("app-relaunch", () => {
    app.relaunch();
    app.exit(0);
  });

  ipcMain.handle("app:open-external", async (_event, rawUrl: unknown) => {
    if (typeof rawUrl !== "string") return false;
    try {
      const parsed = new URL(rawUrl);
      if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
        return false;
      }
      if (!ALLOWED_EXTERNAL_HOSTS.has(parsed.hostname.toLowerCase())) {
        return false;
      }
      await shell.openExternal(parsed.toString());
      return true;
    } catch {
      return false;
    }
  });

  ipcMain.handle("updater:get-version", () => getAppVersion());

  ipcMain.handle("updater:check", () => checkForUpdates(true));

  ipcMain.handle("updater:install", () => {
    installDownloadedUpdate();
  });
}
