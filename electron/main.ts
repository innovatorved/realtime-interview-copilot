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
import { pathToFileURL } from "url";

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
import {
  loadRestoredBounds,
  loadWindowState,
  readStateValue,
  trackWindowState,
  writeStateValue,
} from "./windowState";

let mainWindow: BrowserWindow | null = null;

function getMainWindow(): BrowserWindow | null {
  return mainWindow;
}

// Disable Windows MediaFoundation video capture when problematic on older drivers
if (process.platform === "win32") {
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
    path.join(__dirname, "../package.json"),
    path.join(app.getAppPath(), "package.json"),
  ];
  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) {
        const parsed = JSON.parse(fs.readFileSync(candidate, "utf8")) as {
          build?: { productName?: string };
        };
        const name = parsed.build?.productName;
        if (typeof name === "string" && name.length > 0) {
          return name;
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

  // Restore last session's window position (and size when the renderer
  // doesn't override it) and overlay pin preference. Falls back to the
  // historical top-center default on first run.
  const restored = loadRestoredBounds();
  const savedAlwaysOnTop = loadWindowState().alwaysOnTop;
  const defaultWidth = 1000;
  const defaultHeight = 600;

  mainWindow = new BrowserWindow({
    width: restored?.width ?? defaultWidth,
    height: restored?.height ?? defaultHeight,
    x: restored?.x ?? Math.floor((width - defaultWidth) / 2),
    y: restored?.y ?? 0,
    frame: false,
    resizable: true,
    transparent: true,
    alwaysOnTop: savedAlwaysOnTop !== false,
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

  trackWindowState(mainWindow);
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

  const devPort = process.env.DEV_PORT || "3000";
  const indexFile = path.join(buildPath, "index.html");
  try {
    if (isDev) {
      const devUrl = `http://localhost:${devPort}`;
      await mainWindow.loadURL(devUrl);
    } else {
      await mainWindow.loadFile(indexFile);
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
    // The retry button reloads the real target (dev URL / index.html) so a
    // transient failure (e.g. `next dev` not up yet) is recoverable in-app.
    const retryTarget = isDev
      ? `http://localhost:${devPort}`
      : pathToFileURL(indexFile).href;
    mainWindow.loadURL(
      `data:text/html;charset=utf-8,${encodeURIComponent(
        `<!doctype html><html><body style="font-family:system-ui;background:#141210;color:#edeceb;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0"><div style="text-align:center;max-width:32rem;padding:2rem"><h1 style="font-size:1.1rem;margin:0 0 .5rem">Error loading application</h1><p style="opacity:.7;font-size:.85rem;margin:0 0 1.25rem">${safeMsg}</p><button onclick="location.href='${retryTarget}'" style="background:#34d399;color:#0a0a0a;border:none;padding:.55rem 1.1rem;border-radius:.5rem;font-weight:600;font-size:.85rem;cursor:pointer">Retry</button></div></body></html>`,
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
      // Nudge the user toward System Settings only ONCE per install.
      // Force-opening the privacy pane on every launch felt hijacky and
      // gave no way to opt out; the in-app mic UI still surfaces a clear
      // error on first use afterwards.
      const nudgeAt = readStateValue<string>("micSettingsNudgeAt");
      if (!nudgeAt) {
        writeStateValue("micSettingsNudgeAt", new Date().toISOString());
        shell
          .openExternal(
            "x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone",
          )
          .catch(() => {
            /* best-effort deep link */
          });
      }
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
