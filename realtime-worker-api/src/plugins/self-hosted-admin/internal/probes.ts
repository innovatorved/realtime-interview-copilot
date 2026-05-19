/** Provider health probes. Each probe is cached for HEALTH_CACHE_TTL_MS via
 *  the shared module-level health cache to avoid hammering upstreams. */

import { validateOutboundUrl } from "../../../url-guard";
import { ADMIN_FETCH_TIMEOUT_MS } from "../constants";
import { getCachedHealth, healthCacheKey, setCachedHealth } from "./health-cache";
import type { CfGatewayConfig, HealthCheckResult } from "../types";

export async function probeDeepgram(apiKey: string): Promise<HealthCheckResult> {
  const cacheKey = await healthCacheKey("deepgram", [apiKey]);
  const cached = getCachedHealth(cacheKey);
  if (cached) return cached;
  const t0 = Date.now();
  try {
    if (!apiKey) throw new Error("No API key configured");
    const resp = await fetch("https://api.deepgram.com/v1/projects", {
      headers: { Authorization: `Token ${apiKey}`, accept: "application/json" },
      signal: AbortSignal.timeout(ADMIN_FETCH_TIMEOUT_MS),
    });
    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      throw new Error(`HTTP ${resp.status}: ${text.slice(0, 200)}`);
    }
    const result: HealthCheckResult = {
      ok: true,
      latencyMs: Date.now() - t0,
      lastProbe: new Date().toISOString(),
    };
    setCachedHealth(cacheKey, result);
    return result;
  } catch (e) {
    const result: HealthCheckResult = {
      ok: false,
      latencyMs: Date.now() - t0,
      lastProbe: new Date().toISOString(),
      error: e instanceof Error ? e.message : String(e),
    };
    setCachedHealth(cacheKey, result);
    return result;
  }
}

export async function probeGemini(
  cf: CfGatewayConfig,
  modelName: string,
  apiKey: string,
): Promise<HealthCheckResult> {
  const cacheKey = await healthCacheKey("gemini", [
    cf.accountId,
    cf.gatewayId,
    modelName,
    apiKey,
  ]);
  const cached = getCachedHealth(cacheKey);
  if (cached) return cached;
  const t0 = Date.now();
  try {
    if (!apiKey) throw new Error("No API key configured");
    if (!cf.accountId || !cf.gatewayId)
      throw new Error("AI Gateway not configured");
    // Use header-based auth so the API key never appears in URLs/logs.
    const url = `https://gateway.ai.cloudflare.com/v1/${cf.accountId}/${cf.gatewayId}/google-ai-studio/v1beta/models/${modelName}:generateContent`;
    const resp = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: "ping" }] }],
        generationConfig: { maxOutputTokens: 1 },
      }),
      signal: AbortSignal.timeout(ADMIN_FETCH_TIMEOUT_MS),
    });
    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      throw new Error(`HTTP ${resp.status}: ${text.slice(0, 200)}`);
    }
    await resp.json().catch(() => null);
    const result: HealthCheckResult = {
      ok: true,
      latencyMs: Date.now() - t0,
      lastProbe: new Date().toISOString(),
    };
    setCachedHealth(cacheKey, result);
    return result;
  } catch (e) {
    const result: HealthCheckResult = {
      ok: false,
      latencyMs: Date.now() - t0,
      lastProbe: new Date().toISOString(),
      error: e instanceof Error ? e.message : String(e),
    };
    setCachedHealth(cacheKey, result);
    return result;
  }
}

export async function probeCustomModel(
  modelName: string,
  baseUrl: string,
  apiKey: string,
): Promise<HealthCheckResult> {
  const cacheKey = await healthCacheKey("customModel", [
    modelName,
    baseUrl,
    apiKey,
  ]);
  const cached = getCachedHealth(cacheKey);
  if (cached) return cached;
  const t0 = Date.now();
  try {
    if (!modelName || !baseUrl || !apiKey) {
      const result: HealthCheckResult = {
        ok: false,
        latencyMs: 0,
        lastProbe: new Date().toISOString(),
        configured: false,
        error: "Not configured",
      };
      setCachedHealth(cacheKey, result);
      return result;
    }
    // Reject internal / private / loopback custom URLs before we issue the
    // probe (SSRF defence in depth — the admin endpoint layer also gates
    // which URLs can be stored).
    const ssrf = validateOutboundUrl(baseUrl);
    if (!ssrf.ok) {
      const result: HealthCheckResult = {
        ok: false,
        latencyMs: Date.now() - t0,
        lastProbe: new Date().toISOString(),
        configured: true,
        error: `Blocked URL: ${ssrf.reason}`,
      };
      setCachedHealth(cacheKey, result);
      return result;
    }
    const endpoint = baseUrl.replace(/\/+$/, "") + "/chat/completions";
    const resp = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: modelName,
        max_tokens: 1,
        messages: [{ role: "user", content: "ping" }],
      }),
      signal: AbortSignal.timeout(ADMIN_FETCH_TIMEOUT_MS),
    });
    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      throw new Error(`HTTP ${resp.status}: ${text.slice(0, 200)}`);
    }
    await resp.json().catch(() => null);
    const result: HealthCheckResult = {
      ok: true,
      latencyMs: Date.now() - t0,
      lastProbe: new Date().toISOString(),
      configured: true,
    };
    setCachedHealth(cacheKey, result);
    return result;
  } catch (e) {
    const result: HealthCheckResult = {
      ok: false,
      latencyMs: Date.now() - t0,
      lastProbe: new Date().toISOString(),
      configured: true,
      error: e instanceof Error ? e.message : String(e),
    };
    setCachedHealth(cacheKey, result);
    return result;
  }
}

export function createProbeAiGateway(
  fetchAiGateway: (
    cfg: CfGatewayConfig,
    pathSuffix: string,
    query?: URLSearchParams,
  ) => Promise<{ ok: boolean; status: number; body: unknown }>,
) {
  return async function probeAiGateway(
    cf: CfGatewayConfig,
  ): Promise<HealthCheckResult> {
    const cacheKey = await healthCacheKey("aiGateway", [
      cf.accountId,
      cf.gatewayId,
      cf.apiToken,
    ]);
    const cached = getCachedHealth(cacheKey);
    if (cached) return cached;
    const t0 = Date.now();
    const accountConfigured = Boolean(cf.accountId);
    const gatewayConfigured = Boolean(cf.gatewayId);
    try {
      if (!accountConfigured || !gatewayConfigured)
        throw new Error("Account / Gateway id not configured");
      if (!cf.apiToken) throw new Error("cf_api_token not configured");
      const { ok, status, body } = await fetchAiGateway(cf, "");
      if (!ok)
        throw new Error(
          `HTTP ${status}: ${JSON.stringify(body).slice(0, 200)}`,
        );
      const result: HealthCheckResult = {
        ok: true,
        latencyMs: Date.now() - t0,
        lastProbe: new Date().toISOString(),
        accountConfigured,
        gatewayConfigured,
      };
      setCachedHealth(cacheKey, result);
      return result;
    } catch (e) {
      const result: HealthCheckResult = {
        ok: false,
        latencyMs: Date.now() - t0,
        lastProbe: new Date().toISOString(),
        accountConfigured,
        gatewayConfigured,
        error: e instanceof Error ? e.message : String(e),
      };
      setCachedHealth(cacheKey, result);
      return result;
    }
  };
}
