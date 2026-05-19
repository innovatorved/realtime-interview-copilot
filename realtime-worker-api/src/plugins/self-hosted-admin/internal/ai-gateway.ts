/** Cloudflare AI Gateway helpers: configuration resolution + a thin
 *  fetch wrapper that timeouts and parses JSON safely. */

import { APIError } from "better-auth/api";
import { adminConfig } from "../../../db/schema";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import type * as schemaTypes from "../../../db/schema";
import { ADMIN_FETCH_TIMEOUT_MS } from "../constants";
import type { CfGatewayConfig } from "../types";

type DbHandle = DrizzleD1Database<typeof schemaTypes>;

export function createAiGateway(
  getDb: () => DbHandle,
  runtimeInfo?: () => Record<string, unknown>,
) {
  async function resolveCfConfig(): Promise<CfGatewayConfig> {
    const db = getDb();
    const rows = await db
      .select()
      .from(adminConfig)
      .catch(() => [] as { key: string; value: string }[]);
    const map = new Map(rows.map((r) => [r.key, r.value]));
    const runtime = runtimeInfo?.() ?? {};
    return {
      accountId: String(map.get("cf_account_id") ?? runtime.cfAccountId ?? ""),
      gatewayId: String(map.get("cf_gateway_id") ?? runtime.cfGatewayId ?? ""),
      apiToken: String(map.get("cf_api_token") ?? runtime.cfApiToken ?? ""),
    };
  }

  async function resolveActiveAiConfig() {
    const db = getDb();
    const rows = await db
      .select()
      .from(adminConfig)
      .catch(() => [] as { key: string; value: string }[]);
    const map = new Map(rows.map((r) => [r.key, r.value]));
    const runtime = runtimeInfo?.() ?? {};
    const customModelName = map.get("custom_model_name") || "";
    const customBaseUrl = map.get("custom_base_url") || "";
    const customApiKey = map.get("custom_api_key") || "";
    const useCustom = Boolean(customModelName && customBaseUrl && customApiKey);
    return {
      geminiModel:
        map.get("gemini_model") ||
        String(runtime.geminiModel ?? "") ||
        "gemini-2.5-flash-lite",
      geminiKey: map.get("gemini_key") || String(runtime.geminiKey ?? ""),
      geminiKeySource: map.has("gemini_key")
        ? "dashboard"
        : runtime.geminiKeyConfigured
          ? "env"
          : "none",
      deepgramKey:
        map.get("deepgram_key") || String(runtime.deepgramKey ?? ""),
      deepgramKeySource: map.has("deepgram_key")
        ? "dashboard"
        : runtime.deepgramKeyConfigured
          ? "env"
          : "none",
      customModelName,
      customBaseUrl,
      customApiKey,
      useCustom,
    };
  }

  function cfApiBase(cfg: CfGatewayConfig) {
    // Strict regex guards prevent SSRF via malformed ids.
    if (!/^[a-zA-Z0-9]{1,64}$/.test(cfg.accountId))
      throw new APIError("BAD_REQUEST", { message: "Invalid cf_account_id" });
    if (!/^[a-zA-Z0-9_-]{1,64}$/.test(cfg.gatewayId))
      throw new APIError("BAD_REQUEST", { message: "Invalid cf_gateway_id" });
    if (!cfg.apiToken)
      throw new APIError("FAILED_DEPENDENCY", {
        message: "cf_api_token is not configured",
      });
    return `https://api.cloudflare.com/client/v4/accounts/${cfg.accountId}/ai-gateway/gateways/${cfg.gatewayId}`;
  }

  async function fetchAiGateway(
    cfg: CfGatewayConfig,
    pathSuffix: string,
    query?: URLSearchParams,
  ): Promise<{ ok: boolean; status: number; body: unknown }> {
    const base = cfApiBase(cfg);
    const qs = query && query.toString() ? `?${query.toString()}` : "";
    try {
      const resp = await fetch(`${base}${pathSuffix}${qs}`, {
        headers: {
          Authorization: `Bearer ${cfg.apiToken}`,
          accept: "application/json",
        },
        signal: AbortSignal.timeout(ADMIN_FETCH_TIMEOUT_MS),
      });
      let body: unknown = null;
      try {
        body = await resp.json();
      } catch {
        body = null;
      }
      return { ok: resp.ok, status: resp.status, body };
    } catch (err) {
      return {
        ok: false,
        status: 504,
        body: { error: err instanceof Error ? err.message : String(err) },
      };
    }
  }

  return { resolveCfConfig, resolveActiveAiConfig, fetchAiGateway };
}
