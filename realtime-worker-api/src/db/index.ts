import { drizzle } from "drizzle-orm/d1";
import * as schema from "./schema";

export interface Env {
  DEEPGRAM_API_KEY: string;
  GOOGLE_GENERATIVE_AI_API_KEY: string;
  GEMINI_MODEL?: string;
  BETTER_AUTH_SECRET: string;
  BETTER_AUTH_URL: string;
  DB: D1Database;
}

export const getDb = (env: Env) => {
  return drizzle(env.DB, { schema });
};
