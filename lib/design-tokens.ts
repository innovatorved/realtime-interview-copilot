/** TypeScript mirror of CSS design tokens in app/globals.css */

export const tokens = {
  surface: {
    base: "oklch(0.14 0.008 75)",
    raised: "oklch(0.18 0.008 75)",
    overlay: "oklch(0.22 0.008 75)",
    inset: "oklch(0.12 0.008 75)",
  },
  border: {
    default: "oklch(0.35 0.006 75 / 0.35)",
    subtle: "oklch(0.30 0.006 75 / 0.20)",
    strong: "oklch(0.40 0.006 75 / 0.45)",
  },
  text: {
    primary: "oklch(0.93 0.005 75)",
    secondary: "oklch(0.65 0.006 75)",
    tertiary: "oklch(0.48 0.006 75)",
  },
  accent: {
    DEFAULT: "oklch(0.62 0.12 155)",
    hover: "oklch(0.58 0.12 155)",
    muted: "oklch(0.62 0.12 155 / 0.12)",
    foreground: "oklch(0.98 0.005 75)",
    ring: "oklch(0.62 0.12 155 / 0.35)",
    text: "oklch(0.78 0.10 155)",
  },
  signal: {
    copilot: "oklch(0.72 0.14 65)",
    ask: "oklch(0.65 0.12 240)",
    notes: "oklch(0.55 0.006 75)",
  },
  semantic: {
    destructive: "oklch(0.65 0.18 25)",
    destructiveMuted: "oklch(0.65 0.18 25 / 0.12)",
    success: "oklch(0.68 0.14 155)",
    warning: "oklch(0.75 0.14 85)",
    info: "oklch(0.65 0.12 240)",
  },
  shadow: "oklch(0 0 0 / 0.35)",
  radius: {
    sm: "6px",
    md: "8px",
    lg: "10px",
  },
  font: {
    sans: '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif',
  },
} as const;

/** Legacy auth token mapping for gradual migration */
export const authTokens = {
  pageBg: "oklch(0.14 0.008 75 / 0.92)",
  cardBg: "oklch(0.18 0.008 75)",
  cardBorder: "oklch(0.30 0.006 75 / 0.20)",
  hairline: "oklch(0.30 0.006 75 / 0.20)",
  hairlineSoft: "oklch(0.30 0.006 75 / 0.12)",
  hairlineStrong: "oklch(0.35 0.006 75 / 0.35)",
  inputBg: "oklch(0.12 0.008 75)",
  surfaceSoft: "oklch(0.22 0.008 75 / 0.5)",
  surfaceMid: "oklch(0.16 0.008 75)",
  ink: tokens.text.primary,
  charcoal: tokens.text.primary,
  slate: tokens.text.secondary,
  steel: tokens.text.tertiary,
  stone: "oklch(0.42 0.006 75)",
  muted: tokens.text.tertiary,
  accent: tokens.accent.DEFAULT,
  accentHover: tokens.accent.hover,
  accentSoft: tokens.accent.muted,
  accentRing: tokens.accent.ring,
  accentBorder: "oklch(0.62 0.12 155 / 0.30)",
  accentText: tokens.accent.text,
  sky: tokens.semantic.info,
  skySoft: "oklch(0.65 0.12 240 / 0.12)",
  skyBorder: "oklch(0.65 0.12 240 / 0.30)",
  semanticError: tokens.semantic.destructive,
  semanticErrorSoft: tokens.semantic.destructiveMuted,
  semanticSuccess: tokens.semantic.success,
  errSoft: tokens.semantic.destructiveMuted,
  errBorder: "oklch(0.65 0.18 25 / 0.30)",
  err: tokens.semantic.destructive,
} as const;

export type DesignTokens = typeof tokens;
export type AuthTokens = typeof authTokens;
