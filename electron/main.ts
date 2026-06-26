import {
  app,
  BrowserWindow,
  globalShortcut,
  screen,
  session,
  shell,
  systemPreferences,
} from "electron";
import * as fs from "fs";
import * as path from "path";

import { installSingleInstanceAndDeepLinks } from "./deepLink";
import { registerAppIpc } from "./ipc/app";
import { registerCaptureAndAskShortcut, registerScreenIpc } from "./ipc/screen";
import { attachWindowFocusNotifier, registerWindowIpc } from "./ipc/window";
import {
  installCsp,
  installOriginHeaderInjection,
  pickCsp,
} from "./security/csp";
import {
  installDisplayMediaHandler,
  installPermissionRequestHandler,
} from "./security/permissions";
import { isTrustedOrigin } from "./security/origin";
import { initAutoUpdater } from "./updater";

let mainWindow: BrowserWindow | null = null;

function getMainWindow(): BrowserWindow | null {
  return mainWindow;
}

// Hide from screen share and screen recording on macOS
if (process.platform === "darwin") {
  app.commandLine.appendSwitch(
    "disable-features",
    "MediaFoundationVideoCapture",
  );
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function resolveIconPath(): string {
  if (process.platform === "darwin") {
    // macOS - use larger PNG or .icns if available
    return path.join(__dirname, "../public/icons/android-chrome-512x512.png");
  }
  if (process.platform === "win32") {
    return path.join(__dirname, "../public/icons/favicon.ico");
  }
  return path.join(__dirname, "../public/icons/android-chrome-512x512.png");
}

function loadDisplayName(): string {
  const candidates = [
    path.join(__dirname, "../constant.json"),
    path.join(app.getAppPath(), "constant.json"),
  ];
  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) {
        const parsed = JSON.parse(fs.readFileSync(candidate, "utf8")) as {
          displayName?: string;
        };
        if (
          typeof parsed.displayName === "string" &&
          parsed.displayName.length > 0
        ) {
          return parsed.displayName;
        }
      }
    } catch {
      /* try next candidate */
    }
  }
  return "Meeting Copilot";
}

async function createWindow() {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;
  const iconPath = resolveIconPath();

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
      sandbox: true,
      backgroundThrottling: false,
    },
    skipTaskbar: false,
    show: false,
  });

  attachWindowFocusNotifier(mainWindow);

  const isPackaged = app.isPackaged && !process.env.DEV_PORT;
  installCsp(mainWindow.webContents.session, pickCsp(isPackaged));
  installOriginHeaderInjection(mainWindow.webContents.session);

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
  const isDev = !app.isPackaged || !!process.env.DEV_PORT;
  // Auto-open DevTools when ANY of these signal a debug session:
  //   - `isDev` (renderer pointed at `next dev`)
  //   - `ELECTRON_DEBUG=true` (set by `bun run electron:debug`)
  //   - a `.debug-build` marker file shipped alongside `main.js`
  //     (env vars don't survive a packaged binary, so the marker is
  //     how `bun run electron:build:debug` flags a distributable
  //     debug artifact at build time).
  // Detached mode so the overlay window keeps its declared 1000×600
  // even with DevTools visible — otherwise DevTools docks inside and
  // steals half the UI.
  const debugMarker = (() => {
    try {
      return fs.existsSync(path.join(__dirname, "DEBUG_BUILD"));
    } catch {
      return false;
    }
  })();
  const debugMode =
    isDev || process.env.ELECTRON_DEBUG === "true" || debugMarker;

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
    if (debugMode) {
      mainWindow.webContents.openDevTools({ mode: "detach" });
    }
  } catch (error) {
    console.error("Error loading window content:", error);
    mainWindow.show();
    const safeMsg = escapeHtml(
      error instanceof Error ? error.message : String(error),
    );
    // Render via data URL with an explicit charset; content is fully escaped.
    mainWindow.loadURL(
      `data:text/html;charset=utf-8,${encodeURIComponent(
        `<!doctype html><html><body><h1>Error loading application</h1><p>${safeMsg}</p></body></html>`,
      )}`,
    );
  }

  // Lock navigation to trusted origins. Any attempt to navigate the main
  // window elsewhere (e.g. via a hijacked link) is cancelled, and
  // window.open is blocked — external links are opened in the default
  // browser instead.
  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (!isTrustedOrigin(url)) {
      event.preventDefault();
      shell.openExternal(url).catch((e) => console.error("openExternal:", e));
    }
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isTrustedOrigin(url)) {
      return { action: "allow" };
    }
    shell.openExternal(url).catch((e) => console.error("openExternal:", e));
    return { action: "deny" };
  });

  mainWindow.once("ready-to-show", () => {
    // Whole-window opacity is not used for "see-through" (that is CSS backdrop only).
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

app.whenReady().then(async () => {
  app.setName(loadDisplayName());

  installPermissionRequestHandler(session.defaultSession);
  installDisplayMediaHandler(session.defaultSession);

  // On macOS, proactively request microphone access so the OS-level TCC
  // dialog appears at app launch rather than the first time the user
  // holds Space. We AWAIT this so the permission is resolved before any
  // renderer code calls getUserMedia — otherwise the renderer races the
  // dialog and gets NotAllowedError.
  if (process.platform === "darwin") {
    const micStatus = systemPreferences.getMediaAccessStatus("microphone");
    if (micStatus === "not-determined") {
      try {
        await systemPreferences.askForMediaAccess("microphone");
      } catch {
        /* user denied — renderer will surface the error on first use */
      }
    } else if (micStatus === "denied" || micStatus === "restricted") {
      shell
        .openExternal(
          "x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone",
        )
        .catch(() => {
          /* best-effort deep link */
        });
    }
  }

  createWindow().catch((error) => {
    console.error("Failed to create Electron window:", error);
    app.quit();
  });

  initAutoUpdater(getMainWindow);

  registerCaptureAndAskShortcut(getMainWindow);

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

registerWindowIpc(getMainWindow);
registerScreenIpc(getMainWindow);
registerAppIpc();

// Clean up global shortcuts on quit. We must guard with `app.isReady()`
// because `app.quit()` is called synchronously in the single-instance
// branch below, BEFORE the ready event fires. Touching globalShortcut
// before ready throws "globalShortcut cannot be used until the app is
// ready", which then bubbles up as an uncaughtException at startup.
app.on("will-quit", () => {
  if (!app.isReady()) return;
  try {
    globalShortcut.unregisterAll();
  } catch (err) {
    console.error("Failed to unregister global shortcuts:", err);
  }
});

installSingleInstanceAndDeepLinks(getMainWindow);

// Log and swallow top-level errors so a single failing handler does not
// crash the whole process silently. Keep messages generic to avoid leaking
// tokens from thrown errors.
process.on("uncaughtException", (err) => {
  console.error("[electron main] uncaughtException:", err?.message ?? err);
});
process.on("unhandledRejection", (reason) => {
  const msg = reason instanceof Error ? reason.message : String(reason);
  console.error("[electron main] unhandledRejection:", msg);
});
