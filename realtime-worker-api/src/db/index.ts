import { drizzle } from "drizzle-orm/d1";
import * as schema from "./schema";

export interface Env {
  DEEPGRAM_API_KEY: string;
  GOOGLE_GENERATIVE_AI_API_KEY: string;
  GEMINI_MODEL?: string;
  BETTER_AUTH_SECRET: string;
  BETTER_AUTH_URL: string;
  ADMIN_EMAILS?: string;
  CF_ACCOUNT_ID?: string;
  CF_GATEWAY_ID?: string;
  CF_API_TOKEN?: string;
  /**
   * Base64-encoded 32-byte (256-bit) AES-GCM key used to encrypt BYOK
   * tokens at rest. Provision with:
   *   wrangler secret put BYOK_ENC_KEY
   * The BYOK feature flag refuses to write or decrypt credentials when
   * this is missing, so the system fails closed.
   */
  BYOK_ENC_KEY?: string;
  DB: D1Database;
}

export const getDb = (env: { DB: D1Database }) => {
  return drizzle(env.DB, { schema });
};
