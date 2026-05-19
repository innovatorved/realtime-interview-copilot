import { app, BrowserWindow } from "electron";

type WindowAccessor = () => BrowserWindow | null;

const DEEP_LINK_SCHEME = "realtime-copilot";

/** Validate + route an incoming deep link. We only enable the protocol
 *  client when we can actually validate and route incoming URLs —
 *  otherwise a malicious site could launch us with arbitrary payloads.
 *
 *  Whitelists a small set of action paths; query/hash are dropped so
 *  unvalidated data cannot reach the renderer. */
function handleDeepLink(rawUrl: string | undefined, getWindow: WindowAccessor) {
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
  const allowedHosts = new Set(["open", "auth-callback"]);
  const host = parsed.hostname.toLowerCase();
  if (!allowedHosts.has(host)) {
    console.warn("Ignoring deep link with unknown action:", host);
    return;
  }
  const w = getWindow();
  if (w) {
    if (!w.isVisible()) w.show();
    w.focus();
    w.webContents.send("deep-link", { action: host });
  }
}

/** Enforce single-instance so deep links from a second launch route back
 *  into the running window instead of spawning another process.
 *
 *  In dev mode (DEV_PORT set by `electron:dev`) we deliberately SKIP this
 *  check so a developer can run the dev build alongside the installed
 *  production app without it silently exiting on launch — the prod app
 *  and dev app share the same `appId`, so they fight for the same lock.
 *
 *  Returns `false` when the current process should immediately quit
 *  because another instance owns the lock. */
export function installSingleInstanceAndDeepLinks(
  getWindow: WindowAccessor,
): boolean {
  const isDev = !!process.env.DEV_PORT;
  const gotSingleInstanceLock = isDev ? true : app.requestSingleInstanceLock();
  if (!gotSingleInstanceLock) {
    app.quit();
    return false;
  }

  app.on("second-instance", (_event, argv) => {
    // On Windows/Linux the URL arrives as the last argv entry.
    const maybeUrl = argv.find((a) => a.startsWith(`${DEEP_LINK_SCHEME}://`));
    handleDeepLink(maybeUrl, getWindow);
    const w = getWindow();
    if (w) {
      if (w.isMinimized()) w.restore();
      w.focus();
    }
  });
  app.on("open-url", (event, url) => {
    event.preventDefault();
    handleDeepLink(url, getWindow);
  });
  app.setAsDefaultProtocolClient(DEEP_LINK_SCHEME);
  return true;
}
