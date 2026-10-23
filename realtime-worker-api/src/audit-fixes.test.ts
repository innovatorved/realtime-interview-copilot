import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderMarkdownToHtml } from "./lib/markdown-to-html";
import { csrfCheck } from "./middleware/csrf";
import { withCors } from "./middleware/cors";
import {
  getCachedHealth,
  healthCacheKey,
  setCachedHealth,
} from "./plugins/self-hosted-admin/internal/health-cache";

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
