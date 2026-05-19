"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerAppIpc = registerAppIpc;
const electron_1 = require("electron");
/** App lifecycle IPC: quit + relaunch.
 *
 *  Relaunch is needed after macOS Screen Recording permission changes
 *  because TCC state is cached per-process until the next launch. */
function registerAppIpc() {
    electron_1.ipcMain.handle("app-quit", () => {
        electron_1.app.quit();
    });
    electron_1.ipcMain.handle("app-relaunch", () => {
        electron_1.app.relaunch();
        electron_1.app.exit(0);
    });
}
