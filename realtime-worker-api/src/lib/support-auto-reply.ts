import { inArray } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import { adminConfig } from "../db/schema";
import type * as schema from "../db/schema";

export const DEFAULT_SUPPORT_AUTO_REPLY_BODY = `Hi there,

Thank you for reaching out and for your interest in Realtime Interview Copilot!

Could you please star our GitHub repository here: https://github.com/innovatorved/realtime-interview-copilot

I (Ved) am reviewing requests and will be approving access for everyone — not immediately right this moment as we are rolling out access in batches, but you will get an email notification as soon as your account is approved.

Thanks so much for your patience and support!
— Ved Gupta`;

export const SUPPORT_AUTO_REPLY_KEYS = {
  enabled: "support_auto_reply_enabled",
  firstTimeOnly: "support_auto_reply_first_only",
  body: "support_auto_reply_body",
} as const;

export interface SupportAutoReplyConfig {
  enabled: boolean;
  firstTimeOnly: boolean;
  body: string;
  defaultBody: string;
}

export function parseSupportAutoReplyMap(
  map: Map<string, string>,
): SupportAutoReplyConfig {
  const enabledRaw = map.get(SUPPORT_AUTO_REPLY_KEYS.enabled);
  const firstOnlyRaw = map.get(SUPPORT_AUTO_REPLY_KEYS.firstTimeOnly);
  const bodyRaw = map.get(SUPPORT_AUTO_REPLY_KEYS.body)?.trim();

  return {
    enabled: enabledRaw === undefined ? true : enabledRaw !== "false",
    firstTimeOnly: firstOnlyRaw === undefined ? true : firstOnlyRaw !== "false",
    body: bodyRaw && bodyRaw.length > 0 ? bodyRaw : DEFAULT_SUPPORT_AUTO_REPLY_BODY,
    defaultBody: DEFAULT_SUPPORT_AUTO_REPLY_BODY,
  };
}

export async function resolveSupportAutoReplyConfig(
  db: DrizzleD1Database<typeof schema>,
): Promise<SupportAutoReplyConfig> {
  try {
    const rows = await db
      .select()
      .from(adminConfig)
      .where(
        inArray(adminConfig.key, [
          SUPPORT_AUTO_REPLY_KEYS.enabled,
          SUPPORT_AUTO_REPLY_KEYS.firstTimeOnly,
          SUPPORT_AUTO_REPLY_KEYS.body,
        ]),
      );
    const map = new Map(rows.map((r) => [r.key, r.value]));
    return parseSupportAutoReplyMap(map);
  } catch (err) {
    console.warn("[support-auto-reply] Failed to load config from D1, using defaults:", err);
    return parseSupportAutoReplyMap(new Map());
  }
}
