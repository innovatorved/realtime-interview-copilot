/** AI Gateway logs/detail/summary + provider health endpoints. */

import { eq } from "drizzle-orm";
import { APIError, createAuthEndpoint, sessionMiddleware } from "better-auth/api";
import { user } from "../../../db/schema";
import {
  AI_GATEWAY_LOG_QUERY_KEYS,
  SAFE_ID_RE,
  SUMMARY_WINDOW_MS,
} from "../constants";
import { sanitizeSearch } from "../helpers";
import { healthCacheKey } from "../internal/health-cache";
import type { AdminDeps } from "../types";

export function aiGatewayEndpoints(deps: AdminDeps) {
  const {
    fetchAiGateway,
    getCachedHealth,
    isAdmin,
    opts,
    probeAiGateway,
    probeCustomModel,
    probeDeepgram,
    probeGemini,
    recordAudit,
    resolveActiveAiConfig,
    resolveCfConfig,
  } = deps;
  return {
    adminAiGatewayLogs: createAuthEndpoint(
      "/self-hosted-admin/ai-gateway/logs",
      { method: "GET", use: [sessionMiddleware] },
      async (ctx) => {
        const adminEmail = ctx.context.session.user.email;
        if (!(await isAdmin(adminEmail))) throw new APIError("FORBIDDEN");

        const cf = await resolveCfConfig();
        const url = new URL(ctx.request?.url ?? "http://localhost");

        const forwarded = new URLSearchParams();
        const forwardedFilters: Record<string, string> = {};
        for (const key of AI_GATEWAY_LOG_QUERY_KEYS) {
          const raw = url.searchParams.get(key);
          if (raw === null) continue;
          const trimmed = raw.trim();
          if (!trimmed) continue;
          if (trimmed.length > 200) continue;

          if (key === "per_page") {
            const n = Math.min(50, Math.max(1, Number.parseInt(trimmed, 10) || 20));
            forwarded.set(key, String(n));
            forwardedFilters[key] = String(n);
          } else if (key === "page") {
            const n = Math.max(1, Number.parseInt(trimmed, 10) || 1);
            forwarded.set(key, String(n));
            forwardedFilters[key] = String(n);
          } else {
            forwarded.set(key, trimmed);
            forwardedFilters[key] = trimmed;
          }
        }
        if (!forwarded.has("per_page")) forwarded.set("per_page", "20");
        if (!forwarded.has("order_by")) forwarded.set("order_by", "created_at");
        if (!forwarded.has("order_by_direction"))
          forwarded.set("order_by_direction", "desc");

        const filterUserIdRaw = url.searchParams.get("userId");
        const filterUserEmailRaw = url.searchParams.get("userEmail");

        let filterUserId: string | null =
          filterUserIdRaw && SAFE_ID_RE.test(filterUserIdRaw) ? filterUserIdRaw : null;

        if (!filterUserId && filterUserEmailRaw) {
          const emailQ = sanitizeSearch(filterUserEmailRaw)?.toLowerCase() ?? null;
          if (emailQ) {
            const db = opts.getDb();
            const [row] = await db.select({ id: user.id }).from(user).where(eq(user.email, emailQ));
            if (!row) {
              return ctx.json({
                result: [],
                filtered: true,
                preFilterCount: 0,
                postFilterCount: 0,
                note: "No user with that email — AI Gateway logs are tagged by user_id only.",
              });
            }
            filterUserId = row.id;
          }
        }

        if (filterUserId) {
          forwarded.set("meta_info", "true");
          forwardedFilters["userId"] = filterUserId;
        }

        const { ok, status, body } = await fetchAiGateway(cf, "/logs", forwarded);
        if (!ok) {
          return ctx.json({ ok: false, status, error: body }, { status: 502 });
        }

        let payload = (body ?? {}) as Record<string, unknown>;
        if (filterUserId) {
          const result = Array.isArray(payload.result)
            ? (payload.result as Array<Record<string, unknown>>)
            : [];
          const filtered = result.filter((row) => {
            const meta = row.metadata;
            if (!meta || typeof meta !== "object") return false;
            return (
              String((meta as Record<string, unknown>).user_id ?? "") === filterUserId
            );
          });
          payload = {
            ...payload,
            result: filtered,
            filtered: true,
            preFilterCount: result.length,
            postFilterCount: filtered.length,
          };
        }

        await recordAudit({
          eventType: "admin_action",
          userEmail: adminEmail,
          metadata: { action: "fetch_ai_gateway_logs", filters: forwardedFilters },
        });
        return ctx.json(payload);
      },
    ),

    adminAiGatewayLogDetail: createAuthEndpoint(
      "/self-hosted-admin/ai-gateway/log",
      { method: "GET", use: [sessionMiddleware] },
      async (ctx) => {
        const adminEmail = ctx.context.session.user.email;
        if (!(await isAdmin(adminEmail))) throw new APIError("FORBIDDEN");

        const url = new URL(ctx.request?.url ?? "http://localhost");
        const id = url.searchParams.get("id") ?? "";
        if (!SAFE_ID_RE.test(id))
          throw new APIError("BAD_REQUEST", { message: "Invalid log id" });

        const cf = await resolveCfConfig();
        const { ok, status, body } = await fetchAiGateway(cf, `/logs/${encodeURIComponent(id)}`);
        if (!ok) {
          return ctx.json({ ok: false, status, error: body }, { status: 502 });
        }
        return ctx.json((body ?? {}) as Record<string, unknown>);
      },
    ),

    adminAiGatewaySummary: createAuthEndpoint(
      "/self-hosted-admin/ai-gateway/summary",
      { method: "GET", use: [sessionMiddleware] },
      async (ctx) => {
        const adminEmail = ctx.context.session.user.email;
        if (!(await isAdmin(adminEmail))) throw new APIError("FORBIDDEN");

        const url = new URL(ctx.request?.url ?? "http://localhost");
        const windowKey = url.searchParams.get("window") ?? "24h";
        const windowMs = SUMMARY_WINDOW_MS[windowKey];
        if (!windowMs)
          throw new APIError("BAD_REQUEST", {
            message: "window must be one of 1h, 24h, 7d, 30d",
          });

        const cf = await resolveCfConfig();
        const now = new Date();
        const start = new Date(now.getTime() - windowMs);

        type LogRow = {
          provider?: string;
          model?: string;
          success?: boolean;
          cached?: boolean;
          duration?: number;
          tokens_in?: number;
          tokens_out?: number;
          cost?: number;
        };
        const MAX_PAGES = 6;
        const PER_PAGE = 50;
        const rows: LogRow[] = [];
        let totalCount = 0;

        for (let page = 1; page <= MAX_PAGES; page++) {
          const qs = new URLSearchParams({
            page: String(page),
            per_page: String(PER_PAGE),
            start_date: start.toISOString(),
            end_date: now.toISOString(),
            order_by: "created_at",
            order_by_direction: "desc",
            meta_info: "true",
          });
          const { ok, status, body } = await fetchAiGateway(cf, "/logs", qs);
          if (!ok) {
            return ctx.json({ ok: false, status, error: body }, { status: 502 });
          }
          const parsed = body as {
            result?: LogRow[];
            result_info?: { total_count?: number };
          };
          const result = Array.isArray(parsed?.result) ? parsed.result : [];
          rows.push(...result);
          if (page === 1) totalCount = parsed?.result_info?.total_count ?? result.length;
          if (result.length < PER_PAGE) break;
        }

        let success = 0,
          errors = 0,
          cached = 0;
        let durSum = 0,
          durN = 0;
        let tInSum = 0,
          tInN = 0;
        let tOutSum = 0,
          tOutN = 0;
        let costSum = 0;
        const byProvider: Record<string, { count: number; errors: number; cost: number }> = {};
        const byModel: Record<string, { count: number; errors: number; cost: number }> = {};

        for (const r of rows) {
          if (r.success) success++;
          else errors++;
          if (r.cached) cached++;
          if (typeof r.duration === "number") {
            durSum += r.duration;
            durN++;
          }
          if (typeof r.tokens_in === "number") {
            tInSum += r.tokens_in;
            tInN++;
          }
          if (typeof r.tokens_out === "number") {
            tOutSum += r.tokens_out;
            tOutN++;
          }
          if (typeof r.cost === "number") costSum += r.cost;

          if (r.provider) {
            const b = (byProvider[r.provider] ??= { count: 0, errors: 0, cost: 0 });
            b.count++;
            if (!r.success) b.errors++;
            if (typeof r.cost === "number") b.cost += r.cost;
          }
          if (r.model) {
            const b = (byModel[r.model] ??= { count: 0, errors: 0, cost: 0 });
            b.count++;
            if (!r.success) b.errors++;
            if (typeof r.cost === "number") b.cost += r.cost;
          }
        }

        const sampleSize = rows.length;
        const safeDiv = (a: number, b: number) => (b > 0 ? a / b : 0);

        return ctx.json({
          window: windowKey,
          startedAt: start.toISOString(),
          endedAt: now.toISOString(),
          totalRequests: totalCount,
          sampleSize,
          successRate: safeDiv(success, sampleSize),
          errorRate: safeDiv(errors, sampleSize),
          cachedPct: safeDiv(cached, sampleSize),
          avgDuration: safeDiv(durSum, durN),
          avgTokensIn: safeDiv(tInSum, tInN),
          avgTokensOut: safeDiv(tOutSum, tOutN),
          totalCost: costSum,
          byProvider,
          byModel,
        });
      },
    ),

    adminProvidersHealth: createAuthEndpoint(
      "/self-hosted-admin/providers/health",
      { method: "GET", use: [sessionMiddleware] },
      async (ctx) => {
        if (!(await isAdmin(ctx.context.session.user.email)))
          throw new APIError("FORBIDDEN");

        const url = new URL(ctx.request?.url ?? "http://localhost");
        const deep =
          url.searchParams.get("deep") === "1" || url.searchParams.get("deep") === "true";

        const [ai, cf] = await Promise.all([resolveActiveAiConfig(), resolveCfConfig()]);

        if (!deep) {
          const [geminiKey, deepgramKey, customKey, gatewayKey] = await Promise.all([
            healthCacheKey("gemini", [
              cf.accountId,
              cf.gatewayId,
              ai.geminiModel,
              ai.geminiKey,
            ]),
            healthCacheKey("deepgram", [ai.deepgramKey]),
            healthCacheKey("customModel", [
              ai.customModelName,
              ai.customBaseUrl,
              ai.customApiKey,
            ]),
            healthCacheKey("aiGateway", [
              cf.accountId,
              cf.gatewayId,
              cf.apiToken,
            ]),
          ]);
          const cachedGemini = getCachedHealth(geminiKey);
          const cachedDg = getCachedHealth(deepgramKey);
          const cachedCustom = getCachedHealth(customKey);
          const cachedGw = getCachedHealth(gatewayKey);

          return ctx.json({
            deep: false,
            gemini: cachedGemini ?? {
              ok: Boolean(ai.geminiKey),
              latencyMs: 0,
              lastProbe: "",
              source: ai.geminiKeySource,
              configured: Boolean(ai.geminiKey),
            },
            deepgram: cachedDg ?? {
              ok: Boolean(ai.deepgramKey),
              latencyMs: 0,
              lastProbe: "",
              source: ai.deepgramKeySource,
              configured: Boolean(ai.deepgramKey),
            },
            customModel: cachedCustom ?? {
              ok: false,
              latencyMs: 0,
              lastProbe: "",
              configured: ai.useCustom,
            },
            aiGateway: cachedGw ?? {
              ok: false,
              latencyMs: 0,
              lastProbe: "",
              accountConfigured: Boolean(cf.accountId),
              gatewayConfigured: Boolean(cf.gatewayId),
            },
            activeModel: ai.useCustom ? ai.customModelName : ai.geminiModel,
            useCustomModel: ai.useCustom,
          });
        }

        const [gemini, deepgram, customModel, aiGateway] = await Promise.all([
          probeGemini(cf, ai.geminiModel, ai.geminiKey),
          probeDeepgram(ai.deepgramKey),
          probeCustomModel(ai.customModelName, ai.customBaseUrl, ai.customApiKey),
          probeAiGateway(cf),
        ]);

        return ctx.json({
          deep: true,
          gemini: { ...gemini, source: ai.geminiKeySource },
          deepgram: { ...deepgram, source: ai.deepgramKeySource },
          customModel,
          aiGateway,
          activeModel: ai.useCustom ? ai.customModelName : ai.geminiModel,
          useCustomModel: ai.useCustom,
        });
      },
    ),
  };
}
