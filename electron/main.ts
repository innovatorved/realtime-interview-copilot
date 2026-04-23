import {
  app,
  BrowserWindow,
  desktopCapturer,
  globalShortcut,
  ipcMain,
  screen,
  session,
  shell,
  systemPreferences,
} from "electron";
import * as path from "path";

type ScreenAccessStatus =
  | "not-determined"
  | "granted"
  | "denied"
  | "restricted"
  | "unknown";

function getScreenAccess(): ScreenAccessStatus {
  if (process.platform !== "darwin") return "granted";
  try {
    return systemPreferences.getMediaAccessStatus(
      "screen",
    ) as ScreenAccessStatus;
  } catch {
    return "unknown";
  }
}

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
    width: 1000,
    height: 600,
    x: Math.floor((width - 1000) / 2),
    y: 0,
    frame: false,
    resizable: true,
    transparent: true,
    alwaysOnTop: true,
    backgroundColor: "#00000000",
    hasShadow: true,
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

  // Configure CSP to allow the hosted API
  mainWindow.webContents.session.webRequest.onHeadersReceived(
    (details, callback) => {
      callback({
        responseHeaders: {
          ...details.responseHeaders,
          "Content-Security-Policy": [
            "default-src 'self'; connect-src 'self' http://localhost:8787 https://eu.i.posthog.com https://eu-assets.i.posthog.com https://copilot.vedgupta.in https://realtime-worker-api.innovatorved.workers.dev https://realtime-worker-api-prod.vedgupta.in https://*.deepgram.com https://api.deepgram.com https://www.googletagmanager.com https://www.google-analytics.com wss://*.deepgram.com ws://localhost:* ws://127.0.0.1:*; script-src 'self' 'unsafe-eval' 'unsafe-inline' https://www.googletagmanager.com; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https://www.googletagmanager.com https://eu.i.posthog.com https://eu-assets.i.posthog.com https://www.google-analytics.com; font-src 'self' data:; media-src 'self' blob:; worker-src 'self' blob:;",
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

  if (process.platform === "darwin") {
    mainWindow.setWindowButtonVisibility(false);
    // @ts-ignore - setSharingType exists on macOS 10.15+
    if (mainWindow.setSharingType) {
      // @ts-ignore
      mainWindow.setSharingType("none");
    }
    try {
      mainWindow.setContentProtection(true);
    } catch {
      // Content protection not available
    }
    // Stay visible even when the interviewer's app goes fullscreen (Zoom,
    // Meet, Teams). Content protection still hides us from any screen
    // recording / screen share happening on the remote side.
    try {
      mainWindow.setVisibleOnAllWorkspaces(true, {
        visibleOnFullScreen: true,
      });
    } catch {
      // Not supported on this macOS version
    }
  }

  if (process.platform === "win32" || process.platform === "linux") {
    try {
      mainWindow.setContentProtection(true);
    } catch {
      // Content protection not available on this platform
    }
  }

  const buildPath = path.join(app.getAppPath(), "out");

  const isDev = !app.isPackaged || process.env.DEV_PORT;

  try {
    if (isDev) {
      const devPort = process.env.DEV_PORT || "3000";
      const devUrl = `http://localhost:${devPort}`;
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
    // Whole-window opacity is not used for “see-through” (that is CSS backdrop only).
    mainWindow?.setOpacity(1);
    mainWindow?.show();
  });

  setTimeout(() => {
    if (mainWindow && !mainWindow.isVisible()) {
      mainWindow.show();
    }
  }, 3000);

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

// App lifecycle
app.whenReady().then(() => {
  // Auto-grant media / display-capture permissions for our own app so the
  // first getDisplayMedia() call does not silently fail. The OS-level
  // Screen Recording permission (macOS) is still enforced by the system.
  session.defaultSession.setPermissionRequestHandler(
    (_wc, permission, callback) => {
      if (
        permission === "media" ||
        permission === "display-capture" ||
        permission === "notifications"
      ) {
        callback(true);
        return;
      }
      callback(false);
    },
  );

  // Route renderer getDisplayMedia() calls to system audio loopback, so we
  // capture loudspeaker output natively without requiring BlackHole /
  // VB-Audio virtual devices. We still attach the primary screen as the
  // required video source (Chromium rejects audio-only display media) and
  // the renderer immediately stops the video track.
  session.defaultSession.setDisplayMediaRequestHandler(
    async (_request, callback) => {
      try {
        const sources = await desktopCapturer.getSources({ types: ["screen"] });
        if (sources.length === 0) {
          callback({});
          return;
        }
        callback({ video: sources[0], audio: "loopback" });
      } catch (err) {
        console.error("Failed to provide loopback audio source:", err);
        callback({});
      }
    },
    { useSystemPicker: false },
  );

  createWindow().catch((error) => {
    console.error("Failed to create Electron window:", error);
    app.quit();
  });

  // Global hotkey: capture screen + focus Ask AI. Works even when another
  // app (Zoom, browser, etc.) has focus, so the user can trigger from the
  // interview without switching windows.
  try {
    globalShortcut.register("CommandOrControl+Shift+1", () => {
      if (!mainWindow) return;
      if (!mainWindow.isVisible()) mainWindow.show();
      mainWindow.focus();
      mainWindow.webContents.send("screen:capture-and-ask");
    });
  } catch (err) {
    console.error("Failed to register global shortcut:", err);
  }

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

ipcMain.handle("window-set-size", (_, width: number, height: number) => {
  if (mainWindow) {
    const [currentWidth, currentHeight] = mainWindow.getSize();
    const newWidth = width || currentWidth;
    const newHeight = height || currentHeight;

    if (newWidth !== currentWidth || newHeight !== currentHeight) {
      mainWindow.setSize(newWidth, newHeight, false);
    }
  }
});

ipcMain.handle("window-is-always-on-top", () => {
  return mainWindow?.isAlwaysOnTop() || false;
});

ipcMain.handle("window-is-maximized", () => {
  return mainWindow?.isMaximized() || false;
});

// Handle app quit
ipcMain.handle("app-quit", () => {
  app.quit();
});

// Relaunch the app (needed after macOS Screen Recording permission changes
// because TCC state is cached per-process until the next launch).
ipcMain.handle("app-relaunch", () => {
  app.relaunch();
  app.exit(0);
});

// Screen Recording permission + silent snapshot capture for "Ask AI with
// screenshot". On macOS, a single getSources() call triggers the native
// permission dialog the first time, then subsequent calls are silent.
ipcMain.handle("screen:get-access", () => getScreenAccess());

ipcMain.handle("screen:open-settings", async () => {
  if (process.platform === "darwin") {
    await shell.openExternal(
      "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture",
    );
    return true;
  }
  if (process.platform === "win32") {
    await shell.openExternal("ms-settings:privacy-broadfilesystemaccess");
    return true;
  }
  return false;
});

ipcMain.handle("screen:trigger-prompt", async () => {
  // Calling getSources() is what causes macOS to display the permission
  // prompt the first time. We discard the result.
  try {
    await desktopCapturer.getSources({
      types: ["screen"],
      thumbnailSize: { width: 1, height: 1 },
    });
  } catch {
    // Permission denied or not available
  }
  return getScreenAccess();
});

ipcMain.handle("screen:capture", async () => {
  // Silent full-screen snapshot. Unlike getDisplayMedia() this is a
  // one-shot frame grab; on macOS 13+ it does not engage the continuous
  // recording indicator for longer than the single frame.
  try {
    const { width, height } = screen.getPrimaryDisplay().size;
    const scale = 1; // 1:1, full native resolution
    const sources = await desktopCapturer.getSources({
      types: ["screen"],
      thumbnailSize: {
        width: Math.round(width * scale),
        height: Math.round(height * scale),
      },
    });

    const primary = sources.find((s) => s.display_id) ?? sources[0];
    if (!primary || primary.thumbnail.isEmpty()) {
      return { success: false as const, error: "No screen source available" };
    }

    // Downscale to keep the payload reasonable for the LLM (max ~1600px long edge)
    const maxLongEdge = 1600;
    const longEdge = Math.max(width, height);
    const img =
      longEdge > maxLongEdge
        ? primary.thumbnail.resize({
            width: Math.round(width * (maxLongEdge / longEdge)),
            height: Math.round(height * (maxLongEdge / longEdge)),
          })
        : primary.thumbnail;

    const dataUrl = img.toDataURL(); // image/png base64
    return { success: true as const, dataUrl };
  } catch (err) {
    return {
      success: false as const,
      error: err instanceof Error ? err.message : String(err),
    };
  }
});

// Clean up global shortcuts on quit
app.on("will-quit", () => {
  globalShortcut.unregisterAll();
});

// Handle deep link (if needed for OAuth or other purposes)
app.setAsDefaultProtocolClient("realtime-copilot");
