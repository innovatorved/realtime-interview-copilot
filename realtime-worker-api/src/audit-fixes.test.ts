import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  encryptSecretForKv,
  getCachedConfig,
  invalidateConfigCache,
} from "./config-cache";
import {
  DEFAULT_SUPPORT_AUTO_REPLY_BODY,
  parseSupportAutoReplyMap,
  SUPPORT_AUTO_REPLY_KEYS,
} from "./lib/support-auto-reply";
import { renderMarkdownToHtml } from "./lib/markdown-to-html";
import { csrfCheck } from "./middleware/csrf";
import { withCors } from "./middleware/cors";
import {
  CLIENT_TRACKED_ACTIONS,
  IMPORTANT_EVENT_ACTIONS,
} from "./plugins/self-hosted-admin/constants";
import {
  getCachedHealth,
  healthCacheKey,
  setCachedHealth,
} from "./plugins/self-hosted-admin/internal/health-cache";
import type { Env } from "./env";

describe("renderMarkdownToHtml", () => {
  it("renders markdown links with href=$2 (URL) and label=$1", () => {
    const html = renderMarkdownToHtml("Visit [Docs](https://example.com/docs) now");
    assert.equal(
      html,
      '<p>Visit <a href="https://example.com/docs" rel="noopener noreferrer nofollow">Docs</a> now</p>',
    );
  });
});

describe("csrfCheck & withCors", () => {
  it("enforces X-Requested-With on root /completion and /deepgram aliases", () => {
    const reqNoHeader = new Request("https://realtime-worker-api-prod.vedgupta.in/completion", {
      method: "POST",
      headers: { Origin: "https://copilot.vedgupta.in" },
    });
    assert.equal(csrfCheck(reqNoHeader), "missing_client_header");

    const reqWithHeader = new Request("https://realtime-worker-api-prod.vedgupta.in/completion", {
      method: "POST",
      headers: {
        Origin: "https://copilot.vedgupta.in",
        "X-Requested-With": "RIC-Desktop",
      },
    });
    assert.equal(csrfCheck(reqWithHeader), null);

    const dgNoHeader = new Request("https://realtime-worker-api-prod.vedgupta.in/deepgram", {
      method: "POST",
      headers: { Origin: "null" },
    });
    assert.equal(csrfCheck(dgNoHeader), "missing_client_header");
  });

  it("never reflects Origin: null in Access-Control-Allow-Origin", () => {
    const nullOriginReq = new Request("https://realtime-worker-api-prod.vedgupta.in/api/health", {
      method: "GET",
      headers: { Origin: "null" },
    });
    const res = withCors(new Response("ok"), nullOriginReq);
    assert.notEqual(res.headers.get("Access-Control-Allow-Origin"), "null");
    assert.equal(
      res.headers.get("Access-Control-Allow-Origin"),
      "https://copilot.vedgupta.in",
    );
  });
});

describe("healthCache", () => {
  it("indexes probes under both hashed key and provider prefix for /api/health", async () => {
    const key = await healthCacheKey("gemini", ["acct", "gw", "model", "key"]);
    const sample = {
      ok: true,
      latencyMs: 42,
      lastProbe: new Date().toISOString(),
    };
    setCachedHealth(key, sample);
    assert.deepEqual(getCachedHealth(key), sample);
    assert.deepEqual(getCachedHealth("gemini"), sample);
  });
});

describe("CLIENT_TRACKED_ACTIONS & IMPORTANT_EVENT_ACTIONS", () => {
  it("includes every client-tracked action in IMPORTANT_EVENT_ACTIONS without duplication", () => {
    for (const action of CLIENT_TRACKED_ACTIONS) {
      assert.ok(
        (IMPORTANT_EVENT_ACTIONS as readonly string[]).includes(action),
        `Expected IMPORTANT_EVENT_ACTIONS to include ${action}`,
      );
    }
    const uniqueCount = new Set(IMPORTANT_EVENT_ACTIONS).size;
    assert.equal(uniqueCount, IMPORTANT_EVENT_ACTIONS.length);
  });
});

describe("getCachedConfig KV hit optimization", () => {
  it("decrypts AES-GCM secret ciphertexts from CONFIG_KV without querying D1", async () => {
    const masterSecret = "test-master-secret-for-kv-config-cache-32chars";
    const encGeminiKey = await encryptSecretForKv("AIzaSyTestKey123", masterSecret);
    const encDeepgramKey = await encryptSecretForKv("dg_test_key_456", masterSecret);

    const kvPayload = {
      geminiModel: "gemini-2.5-flash",
      customModelName: "",
      customBaseUrl: "",
      useCustom: false,
      provider: "gemini",
      cfAccountId: "acct-123",
      cfGatewayId: "gw-456",
      modelMaxOutputTokens: 2048,
      modelTemperature: 0.4,
      modelTopP: 0.95,
      modelThinkingBudget: "off",
      encGeminiKey,
      encDeepgramKey,
      encCustomApiKey: "",
      encCfApiToken: "",
    };

    let d1Called = false;
    const mockEnv = {
      BETTER_AUTH_SECRET: masterSecret,
      DB: {
        prepare() {
          d1Called = true;
          throw new Error("D1 should not be queried on a valid CONFIG_KV hit");
        },
      } as unknown as D1Database,
      CONFIG_KV: {
        async get() {
          return kvPayload;
        },
        async put() {},
        async delete() {},
      } as unknown as KVNamespace,
    } as Env;

    await invalidateConfigCache(mockEnv);
    const cfg = await getCachedConfig(mockEnv);

    assert.equal(d1Called, false);
    assert.equal(cfg.geminiKey, "AIzaSyTestKey123");
    assert.equal(cfg.deepgramKey, "dg_test_key_456");
    assert.equal(cfg.geminiModel, "gemini-2.5-flash");
    assert.equal(cfg.cfAccountId, "acct-123");
  });
});

describe("parseSupportAutoReplyMap", () => {
  it("defaults to enabled, firstTimeOnly, and the GitHub star message", () => {
    const cfg = parseSupportAutoReplyMap(new Map());
    assert.equal(cfg.enabled, true);
    assert.equal(cfg.firstTimeOnly, true);
    assert.equal(cfg.body, DEFAULT_SUPPORT_AUTO_REPLY_BODY);
    assert.ok(cfg.body.includes("https://github.com/innovatorved/realtime-interview-copilot"));
  });

  it("respects custom admin_config overrides", () => {
    const cfg = parseSupportAutoReplyMap(
      new Map([
        [SUPPORT_AUTO_REPLY_KEYS.enabled, "false"],
        [SUPPORT_AUTO_REPLY_KEYS.firstTimeOnly, "false"],
        [SUPPORT_AUTO_REPLY_KEYS.body, "Custom star prompt"],
      ]),
    );
    assert.equal(cfg.enabled, false);
    assert.equal(cfg.firstTimeOnly, false);
    assert.equal(cfg.body, "Custom star prompt");
  });
});
