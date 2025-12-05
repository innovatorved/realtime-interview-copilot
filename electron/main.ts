import { app, BrowserWindow, ipcMain, screen } from "electron";
import * as path from "path";
import * as fs from "fs";

let mainWindow: BrowserWindow | null = null;

// Hide from screen share and screen recording on macOS
if (process.platform === "darwin") {
  app.commandLine.appendSwitch(
    "disable-features",
    "MediaFoundationVideoCapture",
  );
}

async function createWindow() {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;

  // Determine icon path based on platform
  let iconPath: string;
  if (process.platform === "darwin") {
    // macOS - use larger PNG or .icns if available
    iconPath = path.join(
      __dirname,
      "../public/icons/android-chrome-512x512.png",
    );
  } else if (process.platform === "win32") {
    // Windows - use .ico
    iconPath = path.join(__dirname, "../public/icons/favicon.ico");
  } else {
    // Linux - use PNG
    iconPath = path.join(
      __dirname,
      "../public/icons/android-chrome-512x512.png",
    );
  }

  mainWindow = new BrowserWindow({
    width: 900,
    height: 700,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    backgroundColor: "#00000000",
    hasShadow: true,
    vibrancy: "under-window",
    visualEffectState: "active",
    icon: iconPath,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: true,
      backgroundThrottling: false,
    },
    skipTaskbar: false,
    show: false,
  });

  // Open DevTools for debugging
  // mainWindow.webContents.openDevTools();

  // Configure CSP to allow the hosted API
  mainWindow.webContents.session.webRequest.onHeadersReceived(
    (details, callback) => {
      callback({
        responseHeaders: {
          ...details.responseHeaders,
          "Content-Security-Policy": [
            "default-src 'self'; connect-src 'self' http://localhost:8787 https://copilot.vedgupta.in https://realtime-worker-api.innovatorved.workers.dev https://realtime-worker-api-prod.vedgupta.in https://*.deepgram.com https://api.deepgram.com https://www.googletagmanager.com https://www.google-analytics.com wss://*.deepgram.com ws://localhost:* ws://127.0.0.1:*; script-src 'self' 'unsafe-eval' 'unsafe-inline' https://www.googletagmanager.com; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https://www.googletagmanager.com https://www.google-analytics.com; font-src 'self' data:; media-src 'self' blob:; worker-src 'self' blob:;",
          ],
        },
      });
    },
  );

  // Inject Origin header for API requests to fix "Missing or null Origin" error
  // This is required because Electron sends "file://" or "null" as origin for local files
  mainWindow.webContents.session.webRequest.onBeforeSendHeaders(
    {
      urls: [
        "https://realtime-worker-api.innovatorved.workers.dev/*",
        "https://realtime-worker-api-prod.vedgupta.in/*",
        "https://*.deepgram.com/*",
        "https://api.deepgram.com/*",
      ],
    },
    (details, callback) => {
      details.requestHeaders["Origin"] = "http://localhost:3000"; // Mimic development origin which is likely whitelisted
      callback({ requestHeaders: details.requestHeaders });
    },
  );

  // Hide from screen capture on macOS
  if (process.platform === "darwin") {
    mainWindow.setWindowButtonVisibility(false);

    // Method 1: Set sharing type to none (macOS 10.15+)
    // @ts-ignore - setSharingType is not in Electron types but exists
    if (mainWindow.setSharingType) {
      // @ts-ignore
      mainWindow.setSharingType("none");
    }

    // Method 2: Additional macOS content protection
    try {
      // This makes the window content not capturable
      mainWindow.setContentProtection(true);
    } catch (e) {
      console.log("Content protection not available:", e);
    }
  }

  // Prevent window from being shown in screen shares (Windows)
  if (process.platform === "win32") {
    mainWindow.setContentProtection(true);

    // Additional Windows protection - set window to be excluded from capture
    try {
      // @ts-ignore - Windows-specific API
      if (mainWindow.setSkipTaskbar) {
        // This helps hide from certain screen capture tools
        mainWindow.setContentProtection(true);
      }
    } catch (e) {
      console.log("Additional Windows protection not available:", e);
    }
  }

  // Linux protection
  if (process.platform === "linux") {
    try {
      mainWindow.setContentProtection(true);
    } catch (e) {
      console.log("Content protection not available on Linux:", e);
    }
  }

  const buildPath = path.join(app.getAppPath(), "out");
  console.log("Build path:", buildPath);
  console.log("Is packaged:", app.isPackaged);
  console.log("App path:", app.getAppPath());

  const isDev = !app.isPackaged || process.env.DEV_PORT;

  try {
    if (isDev) {
      const devPort = process.env.DEV_PORT || "3000";
      const devUrl = `http://localhost:${devPort}`;
      console.log("Loading development URL:", devUrl);
      await mainWindow.loadURL(devUrl);

      setTimeout(() => {
        mainWindow?.webContents.reloadIgnoringCache();
      }, 200);
    } else {
      const indexFile = path.join(buildPath, "index.html");
      await mainWindow.loadFile(indexFile);

      setTimeout(() => {
        mainWindow?.webContents.reloadIgnoringCache();
      }, 200);
    }
  } catch (error) {
    console.error("Error loading window content:", error);
    mainWindow.show();
    mainWindow.loadURL(
      `data:text/html,<html><body><h1>Error loading application</h1><p>${error}</p></body></html>`,
    );
  }

  mainWindow.once("ready-to-show", () => {
    mainWindow?.show();
  });

  // Fallback: show window after 3 seconds if it hasn't shown yet
  setTimeout(() => {
    if (mainWindow && !mainWindow.isVisible()) {
      console.log("Window not visible after 3 seconds, forcing show");
      mainWindow.show();
    }
  }, 3000);

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

// App lifecycle
app.whenReady().then(() => {
  createWindow().catch((error) => {
    console.error("Failed to create Electron window:", error);
    app.quit();
  });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

// IPC Handlers
ipcMain.handle("window-minimize", () => {
  mainWindow?.minimize();
});

ipcMain.handle("window-maximize", () => {
  if (mainWindow?.isMaximized()) {
    mainWindow.unmaximize();
    return false;
  } else {
    mainWindow?.maximize();
    return true;
  }
});

ipcMain.handle("window-close", () => {
  mainWindow?.close();
});

ipcMain.handle("window-always-on-top", (_, flag: boolean) => {
  mainWindow?.setAlwaysOnTop(flag);
  return flag;
});

ipcMain.handle("window-set-opacity", (_, opacity: number) => {
  // Opacity should be between 0 and 1
  const clampedOpacity = Math.max(0.1, Math.min(1, opacity));
  mainWindow?.setOpacity(clampedOpacity);
  return clampedOpacity;
});

ipcMain.handle("window-get-opacity", () => {
  return mainWindow?.getOpacity() || 1;
});

ipcMain.handle("window-is-always-on-top", () => {
  return mainWindow?.isAlwaysOnTop() || false;
});

ipcMain.handle("window-is-maximized", () => {
  return mainWindow?.isMaximized() || false;
});

// Get available audio devices
ipcMain.handle("get-audio-devices", async () => {
  try {
    // This will be called from the renderer process
    // The actual enumeration happens in the renderer due to security
    return { success: true };
  } catch (error) {
    console.error("Error getting audio devices:", error);
    return { success: false, error };
  }
});

// Handle app quit
ipcMain.handle("app-quit", () => {
  app.quit();
});

// Handle deep link (if needed for OAuth or other purposes)
app.setAsDefaultProtocolClient("realtime-copilot");
