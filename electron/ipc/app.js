"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerAppIpc = registerAppIpc;
const electron_1 = require("electron");
const updater_1 = require("../updater");
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
function registerAppIpc() {
    electron_1.ipcMain.handle("app-relaunch", () => {
        electron_1.app.relaunch();
        electron_1.app.exit(0);
    });
    electron_1.ipcMain.handle("app:open-external", async (_event, rawUrl) => {
        if (typeof rawUrl !== "string")
            return false;
        try {
            const parsed = new URL(rawUrl);
            if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
                return false;
            }
            if (!ALLOWED_EXTERNAL_HOSTS.has(parsed.hostname.toLowerCase())) {
                return false;
            }
            await electron_1.shell.openExternal(parsed.toString());
            return true;
        }
        catch {
            return false;
        }
    });
    electron_1.ipcMain.handle("updater:get-version", () => (0, updater_1.getAppVersion)());
    electron_1.ipcMain.handle("updater:check", () => (0, updater_1.checkForUpdates)(true));
    electron_1.ipcMain.handle("updater:install", () => {
        (0, updater_1.installDownloadedUpdate)();
    });
}
