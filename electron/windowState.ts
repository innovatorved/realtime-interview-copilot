import { app, screen, BrowserWindow } from "electron";
import * as fs from "fs";
import * as path from "path";

/**
 * Persist window geometry and overlay preferences across launches.
 *
 * Stored as JSON in userData so it survives updates without an extra
 * dependency. Bounds are validated against the current displays before
 * being applied — a saved position on a detached monitor must never
 * resurrect the window off-screen.
 */

interface WindowBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface PersistedWindowState {
  bounds?: WindowBounds;
  alwaysOnTop?: boolean;
}

/** Generic small-persist helper reused for other launch-once flags
 *  (e.g. mic permission prompts) so we don't grow more files. */
const STATE_FILE = () =>
  path.join(app.getPath("userData"), "window-state.json");

let cachedState: Record<string, unknown> | null = null;

function getCachedState(): Record<string, unknown> {
  if (cachedState !== null) return cachedState;
  try {
    const raw = fs.readFileSync(STATE_FILE(), "utf8");
    const parsed = JSON.parse(raw);
    cachedState =
      parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : {};
  } catch {
    cachedState = {};
  }
  return cachedState;
}

function writeStateFileSync(state: Record<string, unknown>): void {
  try {
    const merged = { ...getCachedState(), ...state };
    cachedState = merged;
    fs.mkdirSync(app.getPath("userData"), { recursive: true });
    fs.writeFileSync(STATE_FILE(), JSON.stringify(merged, null, 2), "utf8");
  } catch {
    /* best-effort persistence */
  }
}

async function writeStateFileAsync(
  state: Record<string, unknown>,
): Promise<void> {
  try {
    const merged = { ...getCachedState(), ...state };
    cachedState = merged;
    const dir = app.getPath("userData");
    await fs.promises.mkdir(dir, { recursive: true });
    await fs.promises.writeFile(
      STATE_FILE(),
      JSON.stringify(merged, null, 2),
      "utf8",
    );
  } catch {
    /* best-effort persistence */
  }
}

export function loadWindowState(): PersistedWindowState {
  return getCachedState() as PersistedWindowState;
}

/** Read a namespaced value previously written via `writeStateValue`. */
export function readStateValue<T>(key: string): T | undefined {
  const state = getCachedState();
  return state[key] as T | undefined;
}

export function writeStateValue(key: string, value: unknown): void {
  void writeStateFileAsync({ [key]: value });
}

/** Saved bounds are only usable when they intersect a current display. */
function boundsAreVisible(bounds: WindowBounds): boolean {
  try {
    return screen.getAllDisplays().some((display) => {
      const wa = display.workArea;
      return (
        bounds.x + bounds.width > wa.x &&
        bounds.y + bounds.height / 2 > wa.y &&
        bounds.x < wa.x + wa.width &&
        bounds.y < wa.y + wa.height
      );
    });
  } catch {
    return false;
  }
}

export function loadRestoredBounds(): WindowBounds | null {
  const { bounds } = loadWindowState();
  if (
    !bounds ||
    typeof bounds.x !== "number" ||
    typeof bounds.y !== "number" ||
    typeof bounds.width !== "number" ||
    typeof bounds.height !== "number"
  ) {
    return null;
  }
  return boundsAreVisible(bounds) ? bounds : null;
}

let saveTimer: NodeJS.Timeout | null = null;

function scheduleSave(window: BrowserWindow): void {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    persistNowAsync(window);
  }, 500);
}

function persistNowAsync(window: BrowserWindow): void {
  if (window.isDestroyed()) return;
  try {
    void writeStateFileAsync({
      bounds: window.getNormalBounds(),
      alwaysOnTop: window.isAlwaysOnTop(),
    });
  } catch {
    /* best-effort persistence */
  }
}

function persistNowSync(window: BrowserWindow): void {
  if (window.isDestroyed()) return;
  try {
    writeStateFileSync({
      bounds: window.getNormalBounds(),
      alwaysOnTop: window.isAlwaysOnTop(),
    });
  } catch {
    /* best-effort persistence */
  }
}

/** Track a window and persist its bounds/preferences until closed. */
export function trackWindowState(window: BrowserWindow): void {
  const onChange = () => scheduleSave(window);
  window.on("resize", onChange);
  window.on("move", onChange);
  window.on("close", () => {
    if (saveTimer) clearTimeout(saveTimer);
    persistNowSync(window);
  });
}
