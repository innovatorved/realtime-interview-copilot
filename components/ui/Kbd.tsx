import * as React from "react";
import { cn } from "@/lib/utils";

export interface KbdProps extends React.HTMLAttributes<HTMLSpanElement> {
  /**
   * Sequence of keys to render. Pass either literal labels ("Esc", "↵",
   * "A") or one of the platform-aware tokens which automatically render
   * the right glyph per OS:
   *
   *   - `"Mod"`   → ⌘ on Mac, `Ctrl` on Windows/Linux
   *   - `"Alt"`   → ⌥ on Mac, `Alt` on Windows/Linux
   *   - `"Shift"` → ⇧ on Mac, `Shift` on Windows/Linux
   *   - `"Ctrl"`  → ⌃ on Mac, `Ctrl` on Windows/Linux (kept distinct from
   *                Mod for shortcuts that must be Ctrl on BOTH platforms,
   *                e.g. our Ctrl+Space mic toggle)
   *
   * Existing literals like the bare `"⌘"`, `"⇧"`, `"⌥"` characters are
   * also translated so older call sites don't need to be updated.
   * Each key is rendered in its own pill; passing a single string also works.
   */
  keys: string | string[];
  /**
   * Visual density. `xs` is for the in-row hint next to small buttons,
   * `sm` is for the suggestion bar / empty-state hints.
   */
  size?: "xs" | "sm";
  /**
   * Separator string drawn between keys (no pill). Default is no separator
   * (the gap between pills is enough), use "+" for `Alt + A` style.
   */
  separator?: string;
}

const sizeClasses: Record<NonNullable<KbdProps["size"]>, string> = {
  // text-[10px] is the existing convention used throughout the app for the
  // tiny inline hints next to icon buttons (camera/send). text-xs is used
  // for the empty-state suggestion bar.
  xs: "text-[10px] px-1 py-0.5 min-w-[14px] h-[14px]",
  sm: "text-[11px] px-1.5 py-0.5 min-w-[16px] h-[16px]",
};

/**
 * Cheap, SSR-safe Mac detection. Defaults to non-Mac on the server so the
 * first paint matches the more common Windows/Linux audience; the next
 * effect tick will hydrate the correct glyphs on Mac clients.
 *
 * navigator.platform is officially deprecated but every browser still
 * returns the expected "MacIntel" / "Win32" / etc. values; userAgentData
 * isn't available cross-browser yet, so we fall back to userAgent text.
 */
function detectMac(): boolean {
  if (typeof navigator === "undefined") return false;
  const platform = (navigator.platform ?? "").toLowerCase();
  if (platform.includes("mac")) return true;
  const ua = (navigator.userAgent ?? "").toLowerCase();
  return ua.includes("mac") && !ua.includes("windows");
}

function useIsMac(): boolean {
  const [isMac, setIsMac] = React.useState<boolean>(false);
  React.useEffect(() => {
    setIsMac(detectMac());
  }, []);
  return isMac;
}

function translateKey(key: string, isMac: boolean): string {
  // Normalise legacy literal Mac glyphs so existing call sites that pass
  // "⌘"/"⇧"/"⌥" get the right thing on Windows for free.
  switch (key) {
    case "Mod":
    case "⌘":
    case "Cmd":
      return isMac ? "⌘" : "Ctrl";
    case "Alt":
    case "⌥":
    case "Option":
      return isMac ? "⌥" : "Alt";
    case "Shift":
    case "⇧":
      return isMac ? "⇧" : "Shift";
    case "Ctrl":
    case "Control":
      return isMac ? "⌃" : "Ctrl";
    default:
      return key;
  }
}

/**
 * Convert a key tuple into the human-readable shortcut string used inside
 * `title` tooltips (e.g. `["Mod","Shift","1"]` on Mac → `"⌘⇧1"`, on
 * Windows → `"Ctrl+Shift+1"`). Exported because button `title` text wants
 * to stay in sync with the visual Kbd pills.
 */
export function formatShortcut(
  keys: string | string[],
  options: { isMac?: boolean } = {},
): string {
  const isMac = options.isMac ?? detectMac();
  const arr = typeof keys === "string" ? [keys] : keys;
  const labels = arr.map((k) => translateKey(k, isMac));
  // Mac convention is to render glyph keys with no separator (⌘⇧1),
  // Windows/Linux uses `+` between word keys (Ctrl+Shift+1) for legibility.
  return isMac ? labels.join("") : labels.join("+");
}

/**
 * Tiny `<kbd>` pill primitive — standardises every keyboard-shortcut hint
 * across Ask AI, Copilot, CompactCopilot and the title bar tabs.
 *
 * Visual rule: subtle by default so it never competes with the icon /
 * label it sits next to. The pill picks up the parent text colour via
 * `text-current` so the surrounding button can drive emphasis on hover.
 */
export function Kbd({
  keys,
  size = "xs",
  separator,
  className,
  ...rest
}: KbdProps) {
  const isMac = useIsMac();
  const arr = typeof keys === "string" ? [keys] : keys;
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-flex items-center gap-0.5 text-current font-mono leading-none select-none",
        className,
      )}
      {...rest}
    >
      {arr.map((key, i) => {
        const label = translateKey(key, isMac);
        // On Windows we widen the pill a touch so multi-letter labels
        // like "Ctrl"/"Shift" don't get squashed by the xs min-width.
        const widePad = label.length > 1;
        return (
          <React.Fragment
            // biome-ignore lint/suspicious/noArrayIndexKey: keys are a small fixed tuple from props; the array never reorders or grows in place, so the positional index IS the stable identity
            key={i}
          >
            {separator && i > 0 ? (
              <span className="text-[9px] opacity-60">{separator}</span>
            ) : null}
            <kbd
              className={cn(
                "inline-flex items-center justify-center rounded border border-border-subtle bg-surface-overlay text-current font-mono leading-none",
                sizeClasses[size],
                widePad && "px-1.5",
              )}
            >
              {label}
            </kbd>
          </React.Fragment>
        );
      })}
    </span>
  );
}

export default Kbd;
