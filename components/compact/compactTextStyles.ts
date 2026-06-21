/** Overlay / transparent-window text — opaque glyphs, transparent shells. */

export const overlayTextShadow =
  "[text-shadow:0_1px_3px_rgba(0,0,0,0.85),0_0_8px_rgba(0,0,0,0.4)]";

/** Halo hugging text blocks — not a full-panel fill. */
export const overlayTextBlock = "rounded-md bg-black/20 backdrop-blur-[2px]";

export const overlayPanel = "bg-transparent";

export const overlayPanelBorder = "border border-border-subtle/40";

export const overlayBubbleAssistant =
  "border border-white/[0.08] bg-black/20 backdrop-blur-[2px]";

export const overlayBubbleUser =
  "border border-accent/20 bg-accent-muted/60 backdrop-blur-[2px]";

export const overlayInput =
  "border-border-subtle/50 bg-black/15 backdrop-blur-[2px]";

export const overlayErrorBlock =
  "rounded-md border border-red-500/25 bg-red-500/[0.08] backdrop-blur-[2px]";

/** Back-compat aliases */
export const compactTextShadow = overlayTextShadow;
export const compactTextSurface = `rounded-md px-2 py-1 ${overlayTextBlock}`;
export const compactBubbleSurface = overlayBubbleAssistant;
export const compactUserBubbleSurface = overlayBubbleUser;
