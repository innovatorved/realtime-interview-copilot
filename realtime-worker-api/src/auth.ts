import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { getDb, Env } from "./db";
import * as schema from "./db/schema";
import { hashPassword, verifyPassword } from "./crypto";

export const auth = (env: Env) => {
  const db = getDb(env);
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
      "https://realtime-worker-api-prod.vedgupta.in",
    ],
    secret: env.BETTER_AUTH_SECRET,
    advanced: {
      defaultCookieAttributes: {
        sameSite: "none",
        secure: true,
      },
    },
  });
};
