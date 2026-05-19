/** Design tokens for the auth screens.
 *
 *  Notion-inspired geometry (8px buttons, 12px cards, Inter type,
 *  generous spacing) layered on the app's neutral-950 + green-500 palette
 *  so this chrome feels native to the Electron shell. The values are
 *  the byte-equivalent union of the previously duplicated TOKEN
 *  constants in `auth-wizard.tsx` and `waiting-for-approval.tsx`.
 *
 *  Note: `auth-guard.tsx` historically used emerald-500 (#10b981) for
 *  its accent rather than green-500 (#22c55e). To preserve visuals on
 *  that screen, the guard keeps its own local accent override and
 *  consumes only the structural / text tokens from this module. */

export const TOKEN = {
  // Surfaces
  pageBg: "rgba(9, 9, 11, 0.55)", // page wrapper (lets the OS backdrop bleed)
  cardBg: "rgba(24, 24, 27, 0.72)", // glass card
  cardBorder: "rgba(255, 255, 255, 0.06)",
  hairline: "rgba(255, 255, 255, 0.06)",
  hairlineSoft: "rgba(255, 255, 255, 0.04)",
  hairlineStrong: "rgba(255, 255, 255, 0.10)",
  inputBg: "rgba(9, 9, 11, 0.6)",
  surfaceSoft: "rgba(255, 255, 255, 0.03)",
  surfaceMid: "rgba(9, 9, 11, 0.45)",
  // Text
  ink: "#fafafa",
  charcoal: "#e4e4e7",
  slate: "#a1a1aa",
  steel: "#71717a",
  stone: "#52525b",
  muted: "#3f3f46",
  // Accent — matches the "Ask AI" tab in the title bar (emerald-600) and
  // the app's accent gradient (#22c55e → #10b981 → #059669).
  accent: "#22c55e", // green-500 (matches accent-gradient start)
  accentHover: "#16a34a", // green-600
  accentSoft: "rgba(34, 197, 94, 0.10)",
  accentRing: "rgba(34, 197, 94, 0.35)",
  accentBorder: "rgba(34, 197, 94, 0.30)",
  accentText: "#86efac", // green-300 — bright on dark glass
  // Cool pending / notice (no warm amber)
  sky: "#38bdf8",
  skySoft: "rgba(56, 189, 248, 0.12)",
  skyBorder: "rgba(56, 189, 248, 0.30)",
  // Semantic
  semanticError: "#f87171",
  semanticErrorSoft: "rgba(248, 113, 113, 0.10)",
  semanticSuccess: "#34d399",
} as const;

export type AuthTokens = typeof TOKEN;
