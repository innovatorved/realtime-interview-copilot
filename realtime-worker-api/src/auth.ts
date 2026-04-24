import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { getDb, Env } from "./db";
import * as schema from "./db/schema";
import { hashPassword, verifyPassword } from "./crypto";
import { selfHostedAdmin } from "./plugins/self-hosted-admin";
import { invalidateConfigCache } from "./config-cache";

/**
 * Canonical list of browser origins we accept. Shared with the worker's CORS
 * layer (see src/index.ts) so Better Auth's origin check and the CORS
 * Access-Control-Allow-Origin response never disagree.
 */
export const TRUSTED_ORIGINS = [
  "http://localhost:3000",
  "http://localhost:3001",
  "https://copilot.vedgupta.in",
  "https://interview-copilot-admin.vedgupta.in",
  "https://realtime-worker-api-prod.vedgupta.in",
] as const;

export const auth = (env: Env & { CONFIG_KV?: KVNamespace }) => {
  const db = getDb(env);

  const adminEmails = (env.ADMIN_EMAILS?.trim() ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter((e) => e.length > 0);

  return betterAuth({
    database: drizzleAdapter(db, {
      provider: "sqlite",
      schema: schema,
    }),
    emailAndPassword: {
      enabled: true,
      password: {
        hash: hashPassword,
        verify: verifyPassword,
      },
    },
    user: {
      additionalFields: {
        isApproved: {
          type: "boolean",
          required: false,
          defaultValue: false,
        },
      },
    },
    trustedOrigins: [...TRUSTED_ORIGINS],
    secret: env.BETTER_AUTH_SECRET,
    advanced: {
      defaultCookieAttributes: {
        sameSite: "none",
        secure: true,
      },
    },
    plugins: [
      selfHostedAdmin({
        getDb: () => db,
        d1: env.DB,
        adminEmails,
        onConfigChange: () => invalidateConfigCache(env),
        sentinel: {
          maxLoginAttemptsPerHour: 10,
          maxSignupsPerHour: 5,
          blockDisposableEmails: true,
        },
        runtimeInfo: () => ({
          geminiModel: env.GEMINI_MODEL?.trim() || "gemini-flash-lite-latest",
          geminiKey: env.GOOGLE_GENERATIVE_AI_API_KEY?.trim() || "",
          deepgramKey: env.DEEPGRAM_API_KEY?.trim() || "",
          geminiKeyConfigured: Boolean(env.GOOGLE_GENERATIVE_AI_API_KEY?.trim()),
          deepgramKeyConfigured: Boolean(env.DEEPGRAM_API_KEY?.trim()),
          cfAccountId: (env as unknown as Record<string, string>).CF_ACCOUNT_ID?.trim() || "",
          cfGatewayId: (env as unknown as Record<string, string>).CF_GATEWAY_ID?.trim() || "",
          cfApiToken: (env as unknown as Record<string, string>).CF_API_TOKEN?.trim() || "",
        }),
      }),
    ],
  });
};
