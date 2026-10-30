import { app, ipcMain } from "electron";

import {
  checkForUpdates,
  getAppVersion,
  installDownloadedUpdate,
} from "../updater";

/** App lifecycle IPC: relaunch + updater.
 *
 *  Relaunch is needed after macOS Screen Recording permission changes
 *  because TCC state is cached per-process until the next launch. */
export function registerAppIpc(): void {
  ipcMain.handle("app-relaunch", () => {
    app.relaunch();
    app.exit(0);
  });

  ipcMain.handle("updater:get-version", () => getAppVersion());

  ipcMain.handle("updater:check", () => checkForUpdates(true));

  ipcMain.handle("updater:install", () => {
    installDownloadedUpdate();
  });
}
