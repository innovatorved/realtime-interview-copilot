/** Admin config CRUD, secret reveal, model test, admin allow-list. */

import { eq } from "drizzle-orm";
import { z } from "zod";
import { APIError, createAuthEndpoint, sessionMiddleware } from "better-auth/api";
import { adminConfig } from "../../../db/schema";
import adminCfg from "../../../config.json";
import { validateOutboundUrl } from "../../../url-guard";
import { ADMIN_FETCH_TIMEOUT_MS, THINKING_BUDGETS } from "../constants";
import { isSecretConfigKey, maskSecret } from "../helpers";
import {
  deleteConfigSchema,
  openaiConfigSchema,
  revealConfigSchema,
  testModelSchema,
  updateConfigSchema,
} from "../schemas";
import type { AdminDeps } from "../types";

/** Default base URL and model used by `POST /openai-config` when the
 *  admin doesn't override them. Chosen to make a one-field "Add OpenAI"
 *  form in the dashboard work out of the box.
 *
 *  `gpt-4o-mini` is intentionally the default — it's cheap, fast, and
 *  available on every region of api.openai.com. */
const OPENAI_DEFAULT_BASE_URL = "https://api.openai.com/v1";
const OPENAI_DEFAULT_MODEL = "gpt-4o-mini";

/** The three admin_config rows that together control the
 *  OpenAI-compatible / custom-provider path. Kept as a const so the
 *  endpoints below stay in lock-step with `config-cache.ts`. */
const OPENAI_CONFIG_KEYS = {
  model: "custom_model_name",
  baseUrl: "custom_base_url",
  apiKey: "custom_api_key",
} as const;

function isDisplayMaskedSecret(value: string): boolean {
  return value.includes("…") || value.includes("...");
}

async function resolveStoredOpenaiConfig(db: ReturnType<AdminDeps["opts"]["getDb"]>) {
  const rows = await db.select().from(adminConfig);
  const map = new Map(rows.map((r) => [r.key, r.value]));
  return {
    model: map.get(OPENAI_CONFIG_KEYS.model) ?? "",
    baseUrl: map.get(OPENAI_CONFIG_KEYS.baseUrl) ?? "",
    apiKey: map.get(OPENAI_CONFIG_KEYS.apiKey) ?? "",
  };
}

export function configEndpoints(deps: AdminDeps) {
  const { envAdmins, invalidateAdminSetCache, isAdmin, opts, recordAudit } = deps;
  return {
    adminGetConfig: createAuthEndpoint(
      "/self-hosted-admin/config",
      { method: "GET", use: [sessionMiddleware] },
      async (ctx) => {
        if (!(await isAdmin(ctx.context.session.user.email)))
          throw new APIError("FORBIDDEN");
        const db = opts.getDb();
        const rows = await db.select().from(adminConfig);
        // Mask secret-like keys by default so a compromised admin session
        // (or admin-UI XSS) cannot exfiltrate full provider keys. Use
        // adminRevealConfig for one-off access to a specific secret.
        const config: Record<string, string> = {};
        const masked: string[] = [];
        for (const r of rows) {
          if (isSecretConfigKey(r.key)) {
            config[r.key] = maskSecret(r.value);
            masked.push(r.key);
          } else {
            config[r.key] = r.value;
          }
        }
        return ctx.json({ config, maskedKeys: masked });
      },
    ),

    adminRevealConfig: createAuthEndpoint(
      "/self-hosted-admin/reveal-config",
      { method: "POST", use: [sessionMiddleware], body: revealConfigSchema },
      async (ctx) => {
        const adminEmail = ctx.context.session.user.email;
        if (!(await isAdmin(adminEmail))) throw new APIError("FORBIDDEN");
        const db = opts.getDb();
        const { key } = ctx.body;
        const [row] = await db.select().from(adminConfig).where(eq(adminConfig.key, key));
        if (!row) throw new APIError("NOT_FOUND", { message: "Config key not found" });
        await recordAudit({
          eventType: "admin_action",
          userEmail: adminEmail,
          metadata: { action: "reveal_config", key },
        });
        return ctx.json({ key, value: row.value });
      },
    ),

    adminUpdateConfig: createAuthEndpoint(
      "/self-hosted-admin/update-config",
      { method: "POST", use: [sessionMiddleware], body: updateConfigSchema },
      async (ctx) => {
        const adminEmail = ctx.context.session.user.email;
        if (!(await isAdmin(adminEmail))) throw new APIError("FORBIDDEN");
        const db = opts.getDb();
        const { key, value } = ctx.body;

        if (key === "custom_base_url") {
          const check = validateOutboundUrl(value);
          if (!check.ok) {
            throw new APIError("BAD_REQUEST", {
              message: `custom_base_url rejected: ${check.reason}`,
            });
          }
        }

        const ranges = adminCfg.modelParams.ranges;
        if (key === "model_max_output_tokens") {
          const n = Number.parseInt(value, 10);
          if (!Number.isFinite(n) || n < ranges.maxOutputTokens.min || n > ranges.maxOutputTokens.max) {
            throw new APIError("BAD_REQUEST", {
              message: `model_max_output_tokens must be integer in [${ranges.maxOutputTokens.min}, ${ranges.maxOutputTokens.max}]`,
            });
          }
        }
        if (key === "model_temperature") {
          const n = Number.parseFloat(value);
          if (!Number.isFinite(n) || n < ranges.temperature.min || n > ranges.temperature.max) {
            throw new APIError("BAD_REQUEST", {
              message: `model_temperature must be in [${ranges.temperature.min}, ${ranges.temperature.max}]`,
            });
          }
        }
        if (key === "model_top_p") {
          const n = Number.parseFloat(value);
          if (!Number.isFinite(n) || n < ranges.topP.min || n > ranges.topP.max) {
            throw new APIError("BAD_REQUEST", {
              message: `model_top_p must be in [${ranges.topP.min}, ${ranges.topP.max}]`,
            });
          }
        }
        if (key === "model_thinking_budget") {
          if (!(THINKING_BUDGETS as readonly string[]).includes(value)) {
            throw new APIError("BAD_REQUEST", {
              message: `model_thinking_budget must be one of ${THINKING_BUDGETS.join(", ")}`,
            });
          }
        }

        const now = new Date();
        const existing = await db.select().from(adminConfig).where(eq(adminConfig.key, key));
        if (existing.length > 0) {
          await db.update(adminConfig).set({ value, updatedAt: now }).where(eq(adminConfig.key, key));
        } else {
          await db.insert(adminConfig).values({ key, value, updatedAt: now });
        }

        const isSecret = key.endsWith("_key") || key.endsWith("_token");
        const maskedValue = isSecret ? `${value.slice(0, 4)}...${value.slice(-4)}` : value;
        await recordAudit({
          eventType: "admin_action",
          userEmail: adminEmail,
          metadata: { action: "update_config", key, value: maskedValue },
        });
        try {
          await opts.onConfigChange?.();
        } catch (e) {
          console.warn("[SelfHostedAdmin] onConfigChange failed:", e);
        }
        return ctx.json({ ok: true });
      },
    ),

    adminDeleteConfig: createAuthEndpoint(
      "/self-hosted-admin/delete-config",
      { method: "POST", use: [sessionMiddleware], body: deleteConfigSchema },
      async (ctx) => {
        const adminEmail = ctx.context.session.user.email;
        if (!(await isAdmin(adminEmail))) throw new APIError("FORBIDDEN");
        const db = opts.getDb();
        const { key } = ctx.body;
        await db.delete(adminConfig).where(eq(adminConfig.key, key));
        await recordAudit({
          eventType: "admin_action",
          userEmail: adminEmail,
          metadata: { action: "delete_config", key },
        });
        try {
          await opts.onConfigChange?.();
        } catch (e) {
          console.warn("[SelfHostedAdmin] onConfigChange failed:", e);
        }
        return ctx.json({ ok: true });
      },
    ),

    adminTestModel: createAuthEndpoint(
      "/self-hosted-admin/test-model",
      { method: "POST", use: [sessionMiddleware], body: testModelSchema },
      async (ctx) => {
        if (!(await isAdmin(ctx.context.session.user.email)))
          throw new APIError("FORBIDDEN");

        const db = opts.getDb();
        const stored = await resolveStoredOpenaiConfig(db);
        const { modelName, baseUrl, apiKey } = ctx.body;

        const resolvedModelName = modelName?.trim() || stored.model || OPENAI_DEFAULT_MODEL;
        const resolvedBaseUrl = baseUrl?.trim() || stored.baseUrl || OPENAI_DEFAULT_BASE_URL;
        const resolvedApiKey =
          typeof apiKey === "string" && apiKey.trim() && !isDisplayMaskedSecret(apiKey)
            ? apiKey.trim()
            : stored.apiKey;

        const ssrf = validateOutboundUrl(resolvedBaseUrl);
        if (!ssrf.ok) {
          return ctx.json({ ok: false, error: `URL rejected: ${ssrf.reason}` });
        }

        if (!resolvedApiKey) {
          return ctx.json({
            ok: false,
            error: "No saved OpenAI API key found — save the settings first, then test the connection.",
          });
        }

        const endpoint = resolvedBaseUrl.replace(/\/+$/, "") + "/chat/completions";
        try {
          const resp = await fetch(endpoint, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${resolvedApiKey}`,
            },
            body: JSON.stringify({
              model: resolvedModelName,
              max_tokens: 32,
              messages: [{ role: "user", content: "Say hello in one word." }],
            }),
            signal: AbortSignal.timeout(ADMIN_FETCH_TIMEOUT_MS),
          });
          if (!resp.ok) {
            const errText = await resp.text().catch(() => "");
            return ctx.json({ ok: false, status: resp.status, error: errText.slice(0, 500) });
          }
          const data = (await resp.json()) as {
            choices?: { message?: { content?: string } }[];
          };
          const reply = data?.choices?.[0]?.message?.content ?? "";
          return ctx.json({ ok: true, reply: reply.slice(0, 200) });
        } catch (e) {
          return ctx.json({ ok: false, error: e instanceof Error ? e.message : String(e) });
        }
      },
    ),

    adminListAdmins: createAuthEndpoint(
      "/self-hosted-admin/admins",
      { method: "GET", use: [sessionMiddleware] },
      async (ctx) => {
        if (!(await isAdmin(ctx.context.session.user.email)))
          throw new APIError("FORBIDDEN");
        const db = opts.getDb();
        const [row] = await db
          .select({ value: adminConfig.value })
          .from(adminConfig)
          .where(eq(adminConfig.key, "admin_emails"));
        const dbAdmins = (row?.value ?? "")
          .split(",")
          .map((s) => s.trim().toLowerCase())
          .filter(Boolean);
        return ctx.json({
          envAdmins: Array.from(envAdmins).sort(),
          dbAdmins: dbAdmins.sort(),
          effective: Array.from(new Set([...envAdmins, ...dbAdmins])).sort(),
        });
      },
    ),

    /**
     * Read the OpenAI-compatible provider's current config in one call.
     * Returns the model name, base URL, masked API key, and whether
     * the custom-provider path will actually be used at /api/completion
     * time (all three rows non-empty). Designed so an admin dashboard's
     * "OpenAI settings" panel can populate itself with a single fetch.
     */
    adminGetOpenaiConfig: createAuthEndpoint(
      "/self-hosted-admin/openai-config",
      { method: "GET", use: [sessionMiddleware] },
      async (ctx) => {
        if (!(await isAdmin(ctx.context.session.user.email)))
          throw new APIError("FORBIDDEN");
        const db = opts.getDb();
        const rows = await db.select().from(adminConfig);
        const map = new Map(rows.map((r) => [r.key, r.value]));
        const model = map.get(OPENAI_CONFIG_KEYS.model) ?? "";
        const baseUrl = map.get(OPENAI_CONFIG_KEYS.baseUrl) ?? "";
        const apiKeyRaw = map.get(OPENAI_CONFIG_KEYS.apiKey) ?? "";
        return ctx.json({
          model,
          baseUrl,
          apiKey: apiKeyRaw ? maskSecret(apiKeyRaw) : "",
          hasApiKey: Boolean(apiKeyRaw),
          enabled: Boolean(model && baseUrl && apiKeyRaw),
          defaults: {
            baseUrl: OPENAI_DEFAULT_BASE_URL,
            model: OPENAI_DEFAULT_MODEL,
          },
        });
      },
    ),

    /**
     * Atomically write the three OpenAI-compatible config rows.
     *
     *  - `apiKey`     (required)
     *  - `baseUrl`    (optional, defaults to api.openai.com/v1)
     *  - `model`      (optional, defaults to gpt-4o-mini)
     *
     * Performs SSRF validation on the resolved base URL exactly the same
     * way `update-config` does for `custom_base_url`, so a compromised
     * admin session cannot redirect completions to `http://169.254.169.254`
     * or similar. Triggers a cache invalidation on success so the next
     * /api/completion call picks the new values up immediately. */
    adminSetOpenaiConfig: createAuthEndpoint(
      "/self-hosted-admin/openai-config",
      {
        method: "POST",
        use: [sessionMiddleware],
        body: openaiConfigSchema,
      },
      async (ctx) => {
        const adminEmail = ctx.context.session.user.email;
        if (!(await isAdmin(adminEmail))) throw new APIError("FORBIDDEN");

        const apiKey = ctx.body.apiKey;
        const baseUrl = ctx.body.baseUrl ?? OPENAI_DEFAULT_BASE_URL;
        const model = ctx.body.model ?? OPENAI_DEFAULT_MODEL;

        const ssrf = validateOutboundUrl(baseUrl);
        if (!ssrf.ok) {
          throw new APIError("BAD_REQUEST", {
            message: `baseUrl rejected: ${ssrf.reason}`,
          });
        }

        const db = opts.getDb();
        const now = new Date();
        const writes: Array<[string, string]> = [
          [OPENAI_CONFIG_KEYS.model, model],
          [OPENAI_CONFIG_KEYS.baseUrl, baseUrl],
          [OPENAI_CONFIG_KEYS.apiKey, apiKey],
        ];
        for (const [key, value] of writes) {
          // D1 doesn't expose a worker-side transaction; emulate
          // upsert-or-insert per key. The full set is idempotent so a
          // partial failure simply leaves stale values for one row,
          // which the next call will overwrite.
          await db
            .insert(adminConfig)
            .values({ key, value, updatedAt: now })
            .onConflictDoUpdate({
              target: adminConfig.key,
              set: { value, updatedAt: now },
            });
        }

        await recordAudit({
          eventType: "admin_action",
          userEmail: adminEmail,
          metadata: {
            action: "set_openai_config",
            model,
            baseUrl,
            apiKey: `${apiKey.slice(0, 4)}...${apiKey.slice(-4)}`,
          },
        });
        try {
          await opts.onConfigChange?.();
        } catch (e) {
          console.warn("[SelfHostedAdmin] onConfigChange failed:", e);
        }
        return ctx.json({
          ok: true,
          model,
          baseUrl,
          apiKey: maskSecret(apiKey),
          enabled: true,
        });
      },
    ),

    /**
     * Delete the three OpenAI-compatible rows so /api/completion falls
     * back to Gemini. Designed for an admin dashboard "Disable OpenAI"
     * action. Idempotent — calling it when nothing is configured is a
     * no-op success. */
    adminClearOpenaiConfig: createAuthEndpoint(
      "/self-hosted-admin/openai-config/clear",
      { method: "POST", use: [sessionMiddleware] },
      async (ctx) => {
        const adminEmail = ctx.context.session.user.email;
        if (!(await isAdmin(adminEmail))) throw new APIError("FORBIDDEN");
        const db = opts.getDb();
        for (const key of Object.values(OPENAI_CONFIG_KEYS)) {
          await db.delete(adminConfig).where(eq(adminConfig.key, key));
        }
        await recordAudit({
          eventType: "admin_action",
          userEmail: adminEmail,
          metadata: { action: "clear_openai_config" },
        });
        try {
          await opts.onConfigChange?.();
        } catch (e) {
          console.warn("[SelfHostedAdmin] onConfigChange failed:", e);
        }
        return ctx.json({ ok: true });
      },
    ),

    adminSetDbAdmins: createAuthEndpoint(
      "/self-hosted-admin/admins",
      {
        method: "POST",
        use: [sessionMiddleware],
        body: z.object({
          emails: z.array(z.string().email().max(254)).max(50),
        }),
      },
      async (ctx) => {
        const adminEmail = ctx.context.session.user.email;
        if (!(await isAdmin(adminEmail))) throw new APIError("FORBIDDEN");
        const db = opts.getDb();
        const { emails } = ctx.body;

        const next = new Set(emails.map((e) => e.trim().toLowerCase()).filter(Boolean));
        if (envAdmins.size === 0 && !next.has(adminEmail.toLowerCase())) {
          throw new APIError("BAD_REQUEST", {
            message:
              "You must keep yourself in the admin list when no env-level admins are configured.",
          });
        }

        const value = Array.from(next).sort().join(",");
        const now = new Date();
        await db
          .insert(adminConfig)
          .values({ key: "admin_emails", value, updatedAt: now })
          .onConflictDoUpdate({
            target: adminConfig.key,
            set: { value, updatedAt: now },
          });

        invalidateAdminSetCache();

        await recordAudit({
          eventType: "admin_action",
          userEmail: adminEmail,
          metadata: { action: "set_admin_emails", count: next.size, adminEmail },
        });

        return ctx.json({ ok: true, dbAdmins: Array.from(next).sort() });
      },
    ),
  };
}
