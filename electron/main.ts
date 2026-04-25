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
import * as fs from "fs";
import * as path from "path";

// ── BYOK dynamic CSP support ─────────────────────────────────────
//
// Users with the `byok` feature flag can supply their own Deepgram +
// OpenAI-compatible endpoints. The renderer talks to those endpoints
// directly, so the host has to be allow-listed in the renderer's
// Content-Security-Policy `connect-src`.
//
// Strategy:
//   1. The worker is the source of truth: only hosts returned by
//      /api/byok/runtime-config (session-cookie gated) ever make it
//      into the CSP.
//   2. We persist the last-known good hosts to userData so the very
//      first request after a cold start (before login completes)
//      already has CSP coverage and avoids a flicker of failed loads.
//   3. The renderer can request a refresh after saving credentials
//      via `electronAPI.refreshCsp()`.
const BYOK_HOSTS_FILE = "byok-hosts.json";
const PROD_BACKEND = "https://realtime-worker-api-prod.vedgupta.in";
let byokExtraHosts: string[] = [];
let currentCsp = "";

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

function byokHostsPath(): string {
  return path.join(app.getPath("userData"), BYOK_HOSTS_FILE);
}

function loadPersistedByokHosts(): string[] {
  try {
    const raw = fs.readFileSync(byokHostsPath(), "utf8");
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (h): h is string => typeof h === "string" && /^[a-z0-9.\-:]+$/i.test(h),
    );
  } catch {
    return [];
  }
}

function savePersistedByokHosts(hosts: string[]) {
  try {
    fs.writeFileSync(byokHostsPath(), JSON.stringify(hosts), "utf8");
  } catch (err) {
    console.warn("[byok] failed to persist hosts:", err);
  }
}

function isAllowedByokHost(host: string): boolean {
  // Hosts come from the worker (which already validated them), but we
  // defensively re-check here so a compromised renderer can't smuggle
  // anything into the CSP via the IPC channel.
  if (typeof host !== "string") return false;
  if (host.length === 0 || host.length > 256) return false;
  if (!/^[a-z0-9.\-]+(:\d{1,5})?$/i.test(host)) return false;
  const lower = host.toLowerCase();
  if (lower === "localhost" || lower.startsWith("localhost:")) return false;
  // Block obvious private IPv4 and loopback ranges (mirrors the worker).
  const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})(?::\d+)?$/.exec(lower);
  if (ipv4) {
    const a = parseInt(ipv4[1]!, 10);
    const b = parseInt(ipv4[2]!, 10);
    if (a === 10 || a === 127 || a === 0) return false;
    if (a === 169 && b === 254) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && b === 168) return false;
    if (a === 100 && b >= 64 && b <= 127) return false;
    if (a >= 224) return false;
  }
  return true;
}

function buildCsp(extraHosts: string[]): string {
  const isPackaged = app.isPackaged && !process.env.DEV_PORT;

  const extraConnect: string[] = [];
  for (const host of extraHosts) {
    if (!isAllowedByokHost(host)) continue;
    extraConnect.push(`https://${host}`);
    extraConnect.push(`wss://${host}`);
  }
  const extra = extraConnect.length > 0 ? ` ${extraConnect.join(" ")}` : "";

  const devCsp =
    `default-src 'self'; connect-src 'self' http://localhost:8787 https://eu.i.posthog.com https://eu-assets.i.posthog.com https://copilot.vedgupta.in https://realtime-worker-api.innovatorved.workers.dev https://realtime-worker-api-prod.vedgupta.in https://*.deepgram.com https://api.deepgram.com https://www.googletagmanager.com https://www.google-analytics.com wss://*.deepgram.com ws://localhost:* ws://127.0.0.1:*${extra}; script-src 'self' 'unsafe-eval' 'unsafe-inline' https://www.googletagmanager.com; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https://www.googletagmanager.com https://eu.i.posthog.com https://eu-assets.i.posthog.com https://www.google-analytics.com; font-src 'self' data:; media-src 'self' blob:; worker-src 'self' blob:; object-src 'none'; base-uri 'self'; frame-ancestors 'none';`;
  const prodCsp =
    `default-src 'self'; connect-src 'self' https://eu.i.posthog.com https://eu-assets.i.posthog.com https://copilot.vedgupta.in https://realtime-worker-api.innovatorved.workers.dev https://realtime-worker-api-prod.vedgupta.in https://*.deepgram.com https://api.deepgram.com https://www.googletagmanager.com https://www.google-analytics.com wss://*.deepgram.com${extra}; script-src 'self' 'unsafe-inline' https://www.googletagmanager.com; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https://www.googletagmanager.com https://eu.i.posthog.com https://eu-assets.i.posthog.com https://www.google-analytics.com; font-src 'self' data:; media-src 'self' blob:; worker-src 'self' blob:; object-src 'none'; base-uri 'self'; frame-ancestors 'none';`;
  return isPackaged ? prodCsp : devCsp;
}

async function fetchByokRuntimeHosts(): Promise<string[]> {
  // The session cookie set by Better Auth lives in the renderer's session;
  // we fetch via that same session so the worker authorises us as the
  // logged-in user. Anything else is treated as "not configured".
  const isPackaged = app.isPackaged && !process.env.DEV_PORT;
  const backend = isPackaged
    ? PROD_BACKEND
    : process.env.BYOK_RUNTIME_API_BASE || PROD_BACKEND;
  try {
    const url = `${backend}/api/byok/runtime-config`;
    const ses = mainWindow?.webContents.session ?? session.defaultSession;
    const res = await ses.fetch(url, {
      method: "GET",
      // Origin needs to match a trusted origin per the worker's CORS layer.
      headers: { Origin: "http://localhost:3000" },
    });
    if (!res.ok) return [];
    const json = (await res.json()) as {
      deepgram?: { host?: string } | null;
      openai?: { host?: string } | null;
    };
    const hosts: string[] = [];
    if (json.deepgram?.host) hosts.push(json.deepgram.host.toLowerCase());
    if (json.openai?.host) hosts.push(json.openai.host.toLowerCase());
    return hosts.filter(isAllowedByokHost);
  } catch (err) {
    console.warn("[byok] runtime-config fetch failed:", err);
    return [];
  }
}

function applyCsp() {
  if (!mainWindow) return;
  currentCsp = buildCsp(byokExtraHosts);
  mainWindow.webContents.session.webRequest.onHeadersReceived(
    (details, callback) => {
      callback({
        responseHeaders: {
          ...details.responseHeaders,
          "Content-Security-Policy": [currentCsp],
        },
      });
    },
  );
}

async function refreshByokCsp(): Promise<{ hosts: string[] }> {
  const fresh = await fetchByokRuntimeHosts();
  byokExtraHosts = fresh;
  savePersistedByokHosts(fresh);
  applyCsp();
  applyOriginInjection();
  return { hosts: fresh };
}

function applyOriginInjection() {
  if (!mainWindow) return;
  const baseUrls = [
    "https://realtime-worker-api.innovatorved.workers.dev/*",
    "https://realtime-worker-api-prod.vedgupta.in/*",
    "https://*.deepgram.com/*",
    "https://api.deepgram.com/*",
  ];
  const byokUrls: string[] = [];
  for (const host of byokExtraHosts) {
    if (!isAllowedByokHost(host)) continue;
    byokUrls.push(`https://${host}/*`);
  }
  mainWindow.webContents.session.webRequest.onBeforeSendHeaders(
    { urls: [...baseUrls, ...byokUrls] },
    (details, callback) => {
      details.requestHeaders["Origin"] = "http://localhost:3000";
      callback({ requestHeaders: details.requestHeaders });
    },
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

// Origins the renderer is allowed to load and request privileged APIs from.
// Packaged builds serve from `file://`; dev uses localhost on the dev port.
function isTrustedOrigin(originUrl: string): boolean {
  try {
    const u = new URL(originUrl);
    if (u.protocol === "file:") return true;
    if (u.protocol === "http:" || u.protocol === "https:") {
      if (u.hostname === "localhost" || u.hostname === "127.0.0.1") return true;
    }
    return false;
  } catch {
    return false;
  }
}

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
      sandbox: true,
      backgroundThrottling: false,
    },
    skipTaskbar: false,
    show: false,
  });

  // Seed CSP with the previously-known BYOK hosts so the very first
  // request after a cold start (before we've had a chance to refresh) is
  // already covered. The renderer can request a refresh after login or
  // settings save via `electronAPI.refreshCsp()`.
  byokExtraHosts = loadPersistedByokHosts();
  applyCsp();
  applyOriginInjection();

  // Best-effort async refresh once the window is alive — silently no-ops
  // if the user isn't logged in / BYOK flag isn't enabled.
  refreshByokCsp().catch((err) => console.warn("[byok] initial refresh failed:", err));

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
    (wc, permission, callback, details) => {
      // Only auto-grant capture / notification permissions when the request
      // comes from our own trusted renderer origin. The OS-level Screen
      // Recording / Microphone prompts still gate actual access.
      const origin = details?.requestingUrl || wc.getURL() || "";
      if (!isTrustedOrigin(origin)) {
        callback(false);
        return;
      }
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
  if (!mainWindow) return;
  const [currentWidth, currentHeight] = mainWindow.getSize();
  const display = screen.getDisplayMatching(mainWindow.getBounds());
  const maxW = display.workAreaSize.width;
  const maxH = display.workAreaSize.height;
  const clamp = (v: number, min: number, max: number) =>
    Math.max(min, Math.min(max, Math.round(v)));
  const w = Number.isFinite(width) && width > 0
    ? clamp(width, 200, maxW)
    : currentWidth;
  const h = Number.isFinite(height) && height > 0
    ? clamp(height, 100, maxH)
    : currentHeight;
  if (w !== currentWidth || h !== currentHeight) {
    mainWindow.setSize(w, h, false);
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

// Re-fetch the user's BYOK runtime config and rebuild the renderer CSP.
// Called by the renderer after the user saves new BYOK credentials so
// requests against the new endpoint succeed without an app restart.
ipcMain.handle("byok:refresh-csp", async () => {
  try {
    const { hosts } = await refreshByokCsp();
    return { ok: true, hosts };
  } catch (err) {
    console.warn("[byok] refreshCsp failed:", err);
    return { ok: false };
  }
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

// Deep link handling (realtime-copilot://...). We only enable the protocol
// client when we can actually validate and route incoming URLs — otherwise a
// malicious site could launch us with arbitrary payloads.
const DEEP_LINK_SCHEME = "realtime-copilot";

function handleDeepLink(rawUrl: string | undefined) {
  if (!rawUrl) return;
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    console.warn("Ignoring malformed deep link");
    return;
  }
  if (parsed.protocol !== `${DEEP_LINK_SCHEME}:`) {
    console.warn("Ignoring deep link with unexpected scheme:", parsed.protocol);
    return;
  }
  // Whitelist a small set of action paths; drop query/hash so unvalidated
  // data can't reach the renderer.
  const allowedHosts = new Set(["open", "auth-callback"]);
  const host = parsed.hostname.toLowerCase();
  if (!allowedHosts.has(host)) {
    console.warn("Ignoring deep link with unknown action:", host);
    return;
  }
  if (mainWindow) {
    if (!mainWindow.isVisible()) mainWindow.show();
    mainWindow.focus();
    mainWindow.webContents.send("deep-link", { action: host });
  }
  // Auth completed — refresh BYOK hosts so the new session can reach
  // the user's Deepgram / OpenAI endpoints without an app restart.
  if (host === "auth-callback") {
    refreshByokCsp().catch(() => {
      /* best-effort */
    });
  }
}

// Enforce single-instance so deep links from a second launch route back
// into the running window instead of spawning another process.
const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", (_event, argv) => {
    // On Windows/Linux the URL arrives as the last argv entry.
    const maybeUrl = argv.find((a) => a.startsWith(`${DEEP_LINK_SCHEME}://`));
    handleDeepLink(maybeUrl);
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
  app.on("open-url", (event, url) => {
    event.preventDefault();
    handleDeepLink(url);
  });
  app.setAsDefaultProtocolClient(DEEP_LINK_SCHEME);
}

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
