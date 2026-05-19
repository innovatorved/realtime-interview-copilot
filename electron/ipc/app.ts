import { app, ipcMain } from "electron";

/** App lifecycle IPC: quit + relaunch.
 *
 *  Relaunch is needed after macOS Screen Recording permission changes
 *  because TCC state is cached per-process until the next launch. */
export function registerAppIpc(): void {
  ipcMain.handle("app-quit", () => {
    app.quit();
  });

  ipcMain.handle("app-relaunch", () => {
    app.relaunch();
    app.exit(0);
  });
}
