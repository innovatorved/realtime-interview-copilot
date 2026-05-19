/** Global model parameter defaults and per-user overrides. */

import { eq } from "drizzle-orm";
import { APIError, createAuthEndpoint, sessionMiddleware } from "better-auth/api";
import { adminConfig, user, userModelParams } from "../../../db/schema";
import adminCfg from "../../../config.json";
import { SAFE_ID_RE, THINKING_BUDGETS } from "../constants";
import {
  modelParamsBodySchema,
  userModelParamsBodySchema,
  userModelParamsDeleteSchema,
} from "../schemas";
import type { AdminDeps } from "../types";

export function modelParamsEndpoints(deps: AdminDeps) {
  const { isAdmin, opts, recordAudit } = deps;
  return {
    adminGetModelParams: createAuthEndpoint(
      "/self-hosted-admin/model-params",
      { method: "GET", use: [sessionMiddleware] },
      async (ctx) => {
        if (!(await isAdmin(ctx.context.session.user.email)))
          throw new APIError("FORBIDDEN");
        const db = opts.getDb();
        const rows = await db.select().from(adminConfig);
        const map = new Map(rows.map((r) => [r.key, r.value]));

        const d = adminCfg.modelParams.defaults;
        const r = adminCfg.modelParams.ranges;

        const effective = {
          maxOutputTokens: d.maxOutputTokens,
          temperature: d.temperature,
          topP: d.topP,
          thinkingBudget: d.thinkingBudget as (typeof THINKING_BUDGETS)[number],
        };
        const rawMax = Number.parseInt(map.get("model_max_output_tokens") ?? "", 10);
        if (
          Number.isFinite(rawMax) &&
          rawMax >= r.maxOutputTokens.min &&
          rawMax <= r.maxOutputTokens.max
        ) {
          effective.maxOutputTokens = rawMax;
        }
        const rawTemp = Number.parseFloat(map.get("model_temperature") ?? "");
        if (
          Number.isFinite(rawTemp) &&
          rawTemp >= r.temperature.min &&
          rawTemp <= r.temperature.max
        ) {
          effective.temperature = rawTemp;
        }
        const rawTopP = Number.parseFloat(map.get("model_top_p") ?? "");
        if (
          Number.isFinite(rawTopP) &&
          rawTopP >= r.topP.min &&
          rawTopP <= r.topP.max
        ) {
          effective.topP = rawTopP;
        }
        const rawTb = map.get("model_thinking_budget");
        if (rawTb && (THINKING_BUDGETS as readonly string[]).includes(rawTb)) {
          effective.thinkingBudget = rawTb as (typeof THINKING_BUDGETS)[number];
        }

        return ctx.json({
          defaults: effective,
          ranges: adminCfg.modelParams.ranges,
          bakedDefaults: adminCfg.modelParams.defaults,
        });
      },
    ),

    adminUpdateModelParams: createAuthEndpoint(
      "/self-hosted-admin/model-params",
      { method: "POST", use: [sessionMiddleware], body: modelParamsBodySchema },
      async (ctx) => {
        const adminEmail = ctx.context.session.user.email;
        if (!(await isAdmin(adminEmail))) throw new APIError("FORBIDDEN");
        const db = opts.getDb();
        const now = new Date();
        const body = ctx.body;

        const pairs: { key: string; value: string }[] = [];
        if (body.maxOutputTokens !== undefined)
          pairs.push({ key: "model_max_output_tokens", value: String(body.maxOutputTokens) });
        if (body.temperature !== undefined)
          pairs.push({ key: "model_temperature", value: String(body.temperature) });
        if (body.topP !== undefined)
          pairs.push({ key: "model_top_p", value: String(body.topP) });
        if (body.thinkingBudget !== undefined)
          pairs.push({ key: "model_thinking_budget", value: body.thinkingBudget });

        for (const { key, value } of pairs) {
          const existing = await db.select().from(adminConfig).where(eq(adminConfig.key, key));
          if (existing.length > 0) {
            await db.update(adminConfig).set({ value, updatedAt: now }).where(eq(adminConfig.key, key));
          } else {
            await db.insert(adminConfig).values({ key, value, updatedAt: now });
          }
        }

        await recordAudit({
          eventType: "admin_action",
          userEmail: adminEmail,
          metadata: { action: "update_model_params", changed: pairs.map((p) => p.key) },
        });
        try {
          await opts.onConfigChange?.();
        } catch (e) {
          console.warn("[SelfHostedAdmin] onConfigChange failed:", e);
        }
        return ctx.json({ ok: true, updated: pairs.length });
      },
    ),

    adminGetUserModelParams: createAuthEndpoint(
      "/self-hosted-admin/user-model-params",
      { method: "GET", use: [sessionMiddleware] },
      async (ctx) => {
        if (!(await isAdmin(ctx.context.session.user.email)))
          throw new APIError("FORBIDDEN");
        const db = opts.getDb();
        const url = new URL(ctx.request?.url ?? "http://localhost");
        const userId = url.searchParams.get("userId");
        if (!userId || !SAFE_ID_RE.test(userId)) {
          throw new APIError("BAD_REQUEST", { message: "Invalid userId" });
        }

        const [row] = await db
          .select()
          .from(userModelParams)
          .where(eq(userModelParams.userId, userId));
        return ctx.json({
          userId,
          override: row
            ? {
                maxOutputTokens: row.maxOutputTokens,
                temperature: row.temperature,
                topP: row.topP,
                thinkingBudget: row.thinkingBudget,
                updatedAt: row.updatedAt,
              }
            : null,
        });
      },
    ),

    adminUpsertUserModelParams: createAuthEndpoint(
      "/self-hosted-admin/user-model-params",
      { method: "POST", use: [sessionMiddleware], body: userModelParamsBodySchema },
      async (ctx) => {
        const adminEmail = ctx.context.session.user.email;
        if (!(await isAdmin(adminEmail))) throw new APIError("FORBIDDEN");
        const db = opts.getDb();
        const { userId, ...fields } = ctx.body;

        const [existingUser] = await db
          .select({ id: user.id })
          .from(user)
          .where(eq(user.id, userId));
        if (!existingUser) throw new APIError("NOT_FOUND", { message: "User not found" });

        const now = new Date();
        const [existing] = await db
          .select()
          .from(userModelParams)
          .where(eq(userModelParams.userId, userId));

        // Build the next row starting from the existing values (or
        // nulls). Explicit `null` in the body clears a field; `undefined`
        // keeps whatever was there before.
        const next = {
          userId,
          maxOutputTokens: existing?.maxOutputTokens ?? null,
          temperature: existing?.temperature ?? null,
          topP: existing?.topP ?? null,
          thinkingBudget: existing?.thinkingBudget ?? null,
          updatedAt: now,
        };
        if (fields.maxOutputTokens !== undefined) next.maxOutputTokens = fields.maxOutputTokens;
        if (fields.temperature !== undefined) next.temperature = fields.temperature;
        if (fields.topP !== undefined) next.topP = fields.topP;
        if (fields.thinkingBudget !== undefined) next.thinkingBudget = fields.thinkingBudget;

        if (existing) {
          await db
            .update(userModelParams)
            .set({
              maxOutputTokens: next.maxOutputTokens,
              temperature: next.temperature,
              topP: next.topP,
              thinkingBudget: next.thinkingBudget,
              updatedAt: now,
            })
            .where(eq(userModelParams.userId, userId));
        } else {
          await db.insert(userModelParams).values(next);
        }

        await recordAudit({
          eventType: "admin_action",
          userEmail: adminEmail,
          metadata: {
            action: "upsert_user_model_params",
            userId,
            changed: Object.keys(fields),
          },
        });
        return ctx.json({ ok: true, override: next });
      },
    ),

    adminDeleteUserModelParams: createAuthEndpoint(
      "/self-hosted-admin/user-model-params-delete",
      { method: "POST", use: [sessionMiddleware], body: userModelParamsDeleteSchema },
      async (ctx) => {
        const adminEmail = ctx.context.session.user.email;
        if (!(await isAdmin(adminEmail))) throw new APIError("FORBIDDEN");
        const db = opts.getDb();
        const { userId } = ctx.body;

        await db.delete(userModelParams).where(eq(userModelParams.userId, userId));
        await recordAudit({
          eventType: "admin_action",
          userEmail: adminEmail,
          metadata: { action: "delete_user_model_params", userId },
        });
        return ctx.json({ ok: true });
      },
    ),
  };
}
