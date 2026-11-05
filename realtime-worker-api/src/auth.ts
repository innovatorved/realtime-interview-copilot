import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { bearer, genericOAuth } from "better-auth/plugins";
import { eq } from "drizzle-orm";
import { getDb, Env } from "./db";
import * as schema from "./db/schema";
import { hashPassword, verifyPassword } from "./crypto";
import { selfHostedAdmin } from "./plugins/self-hosted-admin";
import { DEFAULT_GEMINI_MODEL, invalidateConfigCache } from "./config-cache";

/**
 * Canonical list of browser origins we accept. Shared with the worker's CORS
 * layer (see src/index.ts) so Better Auth's origin check and the CORS
 * Access-Control-Allow-Origin response never disagree.
 */
export const TRUSTED_ORIGINS = [
  "file://",
  "realtime-copilot://",
  "http://localhost:3000",
  "http://localhost:3001",
  "https://copilot.vedgupta.in",
  "https://admin.copilot.vedgupta.in",
  "https://realtime-worker-api-prod.vedgupta.in",
  "https://sso.vedgupta.in",
] as const;

const tokenExchangeCache = new Map<
  string,
  Promise<{
    accessToken?: string;
    refreshToken?: string;
    idToken?: string;
    accessTokenExpiresAt?: Date;
    refreshTokenExpiresAt?: Date;
    scopes?: string[];
    raw?: Record<string, unknown>;
  }>
>();

function decodeJwtClaims(jwt: string): Record<string, unknown> | null {
  try {
    const parts = jwt.split(".");
    if (parts.length !== 3) return null;
    const base64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
    const json = Buffer.from(padded, "base64").toString("utf-8");
    const parsed = JSON.parse(json);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export const auth = (env: Env) => {
  const db = getDb(env);

  const rawAdmins = (env.ADMIN_EMAILS?.trim() ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter((e) => e.length > 0);
  if (!rawAdmins.includes("admin@vedgupta.in")) {
    rawAdmins.push("admin@vedgupta.in");
  }
  const adminEmails = rawAdmins;

  const ssoBase = (env.SSO_BASE_URL || "https://sso.vedgupta.in").replace(/\/$/, "");
  const ssoClientId = env.SSO_CLIENT_ID || "realtime-interview-copilot-app";
  const ssoClientSecret = env.SSO_CLIENT_SECRET?.trim() || "";

  // Route server-to-server SSO calls through Cloudflare Service Binding when available
  // to avoid Cloudflare same-zone Worker-to-Worker 522 errors and save a public network hop.
  const ssoFetch = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const req = new Request(input, init);
    if (env.SSO_SERVICE) {
      return env.SSO_SERVICE.fetch(req);
    }
    return fetch(req);
  };

  return betterAuth({
    baseURL: env.BETTER_AUTH_URL || "https://realtime-worker-api-prod.vedgupta.in",
    database: drizzleAdapter(db, {
      provider: "sqlite",
      schema: schema,
    }),
    emailAndPassword: {
      enabled: false,
      password: {
        hash: hashPassword,
        verify: verifyPassword,
      },
    },
    account: {
      storeStateStrategy: "database",
      skipStateCookieCheck: true,
      accountLinking: {
        enabled: true,
        trustedProviders: ["vedgupta-sso"],
      },
    },
    session: {
      cookieCache: {
        enabled: false,
      },
    },
    databaseHooks: {
      verification: {
        delete: {
          before: async () => false,
        },
      },
    },
    user: {
      additionalFields: {
        role: {
          type: "string",
          required: false,
          defaultValue: "user",
        },
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
      bearer(),
      genericOAuth({
        config: [
          {
            providerId: "vedgupta-sso",
            clientId: ssoClientId,
            clientSecret: ssoClientSecret,
            authorizationUrl: `${ssoBase}/api/auth/oauth2/authorize`,
            tokenUrl: `${ssoBase}/api/auth/oauth2/token`,
            userInfoUrl: `${ssoBase}/api/auth/oauth2/userinfo`,
            scopes: ["openid", "profile", "email", "offline_access"],
            pkce: true,
            getToken: async ({ code, redirectURI, codeVerifier }) => {
              const cached = tokenExchangeCache.get(code);
              if (cached) return cached;

              const promise = (async () => {
                const headers: Record<string, string> = {
                  "content-type": "application/x-www-form-urlencoded",
                  accept: "application/json",
                  "user-agent": "realtime-interview-copilot/1.0",
                };
                const body = new URLSearchParams({
                  grant_type: "authorization_code",
                  code,
                  redirect_uri: redirectURI,
                });

                if (ssoClientSecret) {
                  const basic = btoa(`${ssoClientId}:${ssoClientSecret}`);
                  headers.authorization = `Basic ${basic}`;
                } else {
                  body.set("client_id", ssoClientId);
                }

                if (codeVerifier) {
                  body.set("code_verifier", codeVerifier);
                }

                const res = await ssoFetch(`${ssoBase}/api/auth/oauth2/token`, {
                  method: "POST",
                  headers,
                  body: body.toString(),
                });

                const text = await res.text();
                if (!res.ok) {
                  throw new Error(`SSO token exchange failed (${res.status}): ${text}`);
                }
                const data = JSON.parse(text) as {
                  access_token?: string;
                  refresh_token?: string;
                  id_token?: string;
                  expires_in?: number;
                  refresh_token_expires_in?: number;
                  scope?: string;
                };
                return {
                  accessToken: data.access_token,
                  refreshToken: data.refresh_token,
                  idToken: data.id_token,
                  accessTokenExpiresAt: data.expires_in
                    ? new Date(Date.now() + data.expires_in * 1000)
                    : undefined,
                  refreshTokenExpiresAt: data.refresh_token_expires_in
                    ? new Date(Date.now() + data.refresh_token_expires_in * 1000)
                    : undefined,
                  scopes: data.scope ? data.scope.split(" ") : [],
                  raw: data as Record<string, unknown>,
                };
              })();

              tokenExchangeCache.set(code, promise);
              setTimeout(() => tokenExchangeCache.delete(code), 60_000);
              return promise;
            },
            getUserInfo: async (tokens) => {
              // Fast path: decode id_token claims directly (saves 1 extra call to sso.vedgupta.in)
              interface SsoUserInfoProfile {
                sub?: string;
                id?: string;
                email?: string;
                name?: string;
                picture?: string;
                image?: string;
                email_verified?: boolean;
                emailVerified?: boolean;
                role?: string;
                approved?: boolean | number;
              }
              let profile: SsoUserInfoProfile | null = null;

              if (tokens.idToken) {
                profile = decodeJwtClaims(tokens.idToken) as SsoUserInfoProfile | null;
              }

              if (!profile || (!profile.sub && !profile.id) || !profile.email) {
                const res = await ssoFetch(`${ssoBase}/api/auth/oauth2/userinfo`, {
                  headers: {
                    authorization: `Bearer ${tokens.accessToken}`,
                    accept: "application/json",
                  },
                });
                if (!res.ok) return null;
                profile = (await res.json()) as SsoUserInfoProfile | null;
              }

              const id = profile?.sub ?? profile?.id;
              const email = profile?.email?.toLowerCase().trim();
              if (!id || !email) return null;

              const isPrimaryAdmin = adminEmails.includes(email);
              const resolvedRole =
                isPrimaryAdmin || profile?.role === "admin" ? "admin" : "user";

              let resolvedApproved = isPrimaryAdmin;
              let effectiveRole = resolvedRole;

              try {
                const [existingUser] = await db
                  .select({
                    isApproved: schema.user.isApproved,
                    role: schema.user.role,
                  })
                  .from(schema.user)
                  .where(eq(schema.user.email, email))
                  .limit(1);

                if (existingUser) {
                  // Existing user: preserve the admin's approval decision in Interview Copilot
                  resolvedApproved =
                    isPrimaryAdmin ||
                    Boolean(existingUser.isApproved) ||
                    existingUser.role === "admin";
                  if (!isPrimaryAdmin && existingUser.role) {
                    effectiveRole = existingUser.role;
                  }
                } else {
                  // New user: NEVER auto-approve in Interview Copilot, even if approved on SSO.
                  // An administrator must explicitly approve the user in Interview Copilot admin panel.
                  resolvedApproved = isPrimaryAdmin;
                  effectiveRole = "user";
                }
              } catch (e) {
                console.warn("[SSO] Failed to lookup existing user approval status:", e);
              }

              // Sync role and isApproved onto existing user rows in realtime-interview-copilot-db
              try {
                await db
                  .update(schema.user)
                  .set({
                    role: isPrimaryAdmin ? "admin" : effectiveRole,
                    isApproved: resolvedApproved,
                    emailVerified: true,
                    updatedAt: new Date(),
                  })
                  .where(eq(schema.user.email, email));
              } catch (e) {
                console.warn("[SSO] Failed to sync user role/approval on login:", e);
              }

              return {
                id,
                email,
                name: profile?.name ?? email.split("@")[0] ?? "User",
                image: profile?.picture ?? profile?.image ?? undefined,
                emailVerified: profile?.email_verified ?? profile?.emailVerified ?? true,
                role: isPrimaryAdmin ? "admin" : effectiveRole,
                isApproved: resolvedApproved,
              };
            },
          },
        ],
      }),
      selfHostedAdmin({
        getDb: () => db,
        d1: env.DB,
        env,
        adminEmails,
        onConfigChange: () => invalidateConfigCache(env),
        sentinel: {
          maxLoginAttemptsPerHour: 0,
          maxSignupsPerHour: 0,
          blockDisposableEmails: true,
        },
        runtimeInfo: () => ({
          geminiModel: env.GEMINI_MODEL?.trim() || DEFAULT_GEMINI_MODEL,
          geminiKey: env.GOOGLE_GENERATIVE_AI_API_KEY?.trim() || "",
          deepgramKey: env.DEEPGRAM_API_KEY?.trim() || "",
          geminiKeyConfigured: Boolean(env.GOOGLE_GENERATIVE_AI_API_KEY?.trim()),
          deepgramKeyConfigured: Boolean(env.DEEPGRAM_API_KEY?.trim()),
          cfAccountId: env.CF_ACCOUNT_ID?.trim() || "",
          cfGatewayId: env.CF_GATEWAY_ID?.trim() || "",
          cfApiToken: env.CF_API_TOKEN?.trim() || "",
        }),
      }),
    ],
  });
};
