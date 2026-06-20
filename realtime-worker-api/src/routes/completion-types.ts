/** Shared types and small parsers for the completion route. */

export const SSE_BUFFER_MAX = 256 * 1024;

export enum FLAGS {
  COPILOT = "copilot",
  SUMMARIZER = "summarizer",
  ASK_AI = "ask-ai",
}

/** Hard cap on attached images per /api/completion call. Keeps per-request
 *  payload size, model token cost and screen-shot fan-out bounded — also
 *  matches the renderer-side MAX_IMAGES so any extra screenshots a client
 *  somehow sends are silently dropped here. */
export const MAX_IMAGES_PER_REQUEST = 4;

/** Hard cap on the number of messages we accept in a single chat request.
 *  24 = ~12 user + 12 assistant turns. Anything older the client must drop
 *  before sending. */
export const MAX_MESSAGES_PER_REQUEST = 24;

/** Cap on text length PER message in a chat. Combined with MAX_MESSAGES
 *  this bounds the total prompt characters sent to the model. */
export const MAX_CHAT_MESSAGE_CHARS = 8000;

export const MAX_PROMPT_CHARS = 32_000;
export const MAX_BG_CHARS = 16_000;

export interface ChatMessageBody {
  role: "user" | "assistant";
  text: string;
  /** Optional images attached to this message as data URLs. Capped per
   *  message (MAX_IMAGES_PER_REQUEST). Older history turns can include
   *  images too; clients SHOULD only attach them to the most recent
   *  user turn to keep tokens reasonable. */
  images?: string[];
}

export interface CompletionRequestBody {
  bg?: string;
  flag?: string;
  prompt?: string;
  /** Optional image attached to the prompt as a data URL (e.g. data:image/png;base64,...). */
  image?: string | string[];
  /** Optional multi-turn conversation history. When supplied (length > 0)
   *  the final element MUST be a `user` message — it represents the
   *  question being submitted now — and `prompt` / `image` are ignored.
   *  Older entries provide context the model gets to see. Only meaningful
   *  for the COPILOT and ASK_AI flags; other flags continue to use the
   *  single-turn `prompt` path. */
  messages?: ChatMessageBody[];
}

export interface InlineImage {
  mimeType: string;
  base64: string;
}

/** Internal wire-format message after parsing/validating ChatMessageBody. */
export interface WireMessage {
  role: "user" | "assistant";
  text: string;
  images: InlineImage[];
}

export function parseImageDataUrl(input: string | undefined): InlineImage | null {
  if (!input) return null;
  const match = /^data:([^;]+);base64,(.+)$/.exec(input.trim());
  if (!match) return null;
  const mime = match[1];
  const data = match[2];
  if (!/^image\/(png|jpeg|jpg|webp|gif)$/i.test(mime)) return null;
  if (data.length > (8 * 1024 * 1024 * 4) / 3) return null;
  return { mimeType: mime, base64: data };
}

export function parseImageDataUrls(
  input: string | string[] | undefined,
): InlineImage[] {
  if (input === undefined || input === null) return [];
  const raw = Array.isArray(input) ? input : [input];
  const out: InlineImage[] = [];
  for (const candidate of raw) {
    if (out.length >= MAX_IMAGES_PER_REQUEST) break;
    if (typeof candidate !== "string") continue;
    const parsed = parseImageDataUrl(candidate);
    if (parsed) out.push(parsed);
  }
  return out;
}
