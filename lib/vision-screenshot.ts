/**
 * Aligns with `parseImageDataUrl` in realtime-worker-api: base64 PNG/JPEG/WebP/GIF only.
 */
const VISION_DATA_URL_RE = /^data:image\/(png|jpeg|jpg|webp|gif);base64,/i;

export const VISION_FALLBACK_PROMPT =
  "Analyze this screenshot and explain what's happening. If it shows an interview question, answer it thoroughly.";

/** True when the string is an image data URL the completion worker will accept as `image`. */
export function isVisionScreenshotDataUrl(value: unknown): value is string {
  return typeof value === "string" && VISION_DATA_URL_RE.test(value.trim());
}
