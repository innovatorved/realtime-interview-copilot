import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { getDb, Env } from "./db";
import * as schema from "./db/schema";
import { hashPassword, verifyPassword } from "./crypto";
import { selfHostedAdmin } from "./plugins/self-hosted-admin";

export const auth = (env: Env) => {
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
    trustedOrigins: [
      "http://localhost:3000",
      "http://localhost:3001",
      "https://interview-copilot-admin.vedgupta.in",
      "https://realtime-worker-api-prod.vedgupta.in",
    ],
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
        sentinel: {
          maxLoginAttemptsPerHour: 10,
          maxSignupsPerHour: 5,
          blockDisposableEmails: true,
        },
        runtimeInfo: () => ({
          geminiModel: env.GEMINI_MODEL?.trim() || "gemini-flash-lite-latest",
          geminiKeyConfigured: Boolean(env.GOOGLE_GENERATIVE_AI_API_KEY?.trim()),
          deepgramKeyConfigured: Boolean(env.DEEPGRAM_API_KEY?.trim()),
          posthogConfigured: Boolean((env as unknown as Record<string, string>).POSTHOG_API_KEY?.trim()),
        }),
      }),
    ],
  });
};
