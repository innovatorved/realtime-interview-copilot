/** Completion provider adapter interface. */

import type { EffectiveModelParams } from "../config-cache";
import type { WireMessage } from "../routes/completion-types";

export type CompletionChunk = { text?: string; error?: string };

export interface CompletionProvider {
  stream(
    messages: WireMessage[],
    params: EffectiveModelParams,
    writer: WritableStreamDefaultWriter<Uint8Array>,
  ): Promise<void>;
}

export type { WireMessage };
