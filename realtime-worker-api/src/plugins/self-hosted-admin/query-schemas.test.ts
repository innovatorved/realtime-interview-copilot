import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { APIError } from "better-auth/api";
import { parseAdminQuery } from "./helpers";
import {
  importantEventsQuerySchema,
  listUsersQuerySchema,
  requiredUserIdQuerySchema,
  resolveImportantEventActions,
  supportThreadsQuerySchema,
  usageSummaryQuerySchema,
} from "./query-schemas";
import { openaiConfigSchema } from "./schemas";

describe("admin query schemas", () => {
  it("parses list-users pagination and filter", () => {
    const url = new URL("http://localhost/list-users?limit=10&filter=pending");
    const q = parseAdminQuery(url, listUsersQuerySchema, ["limit", "offset", "q", "filter"]);
    assert.equal(q.limit, 10);
    assert.equal(q.filter, "pending");
  });

  it("rejects invalid userId", () => {
    const url = new URL("http://localhost/get-user?userId=bad/id");
    assert.throws(
      () => parseAdminQuery(url, requiredUserIdQuerySchema, ["userId"]),
      (err: unknown) => err instanceof APIError && err.status === "BAD_REQUEST",
    );
  });

  it("parses usage window", () => {
    const url = new URL("http://localhost/usage/summary?window=7d");
    const q = parseAdminQuery(url, usageSummaryQuerySchema, ["window"]);
    assert.equal(q.window, "7d");
  });

  it("parses support unreadOnly as boolean", () => {
    const url = new URL("http://localhost/support/threads?unreadOnly=true");
    const q = parseAdminQuery(url, supportThreadsQuerySchema, [
      "limit",
      "offset",
      "status",
      "unreadOnly",
      "userId",
      "q",
    ]);
    assert.equal(q.unreadOnly, true);
  });

  it("filters important event actions to allow-list", () => {
    const actions = resolveImportantEventActions("completion,invalid_action");
    assert.ok(actions.includes("completion"));
    assert.ok(!actions.includes("invalid_action"));
  });

  it("rejects invalid important-events sort", () => {
    const url = new URL("http://localhost/important-events?sort=sideways");
    assert.throws(() =>
      parseAdminQuery(url, importantEventsQuerySchema, [
        "limit",
        "offset",
        "userId",
        "status",
        "sessionId",
        "q",
        "start",
        "end",
        "sort",
        "actions",
      ]),
    );
  });
});

describe("admin body schemas", () => {
  it("allows partial openai-config without apiKey", () => {
    const parsed = openaiConfigSchema.safeParse({
      baseUrl: "https://api.openai.com/v1",
      model: "gpt-4o-mini",
    });
    assert.equal(parsed.success, true);
  });

  it("rejects invalid openai baseUrl", () => {
    const parsed = openaiConfigSchema.safeParse({ baseUrl: "not-a-url" });
    assert.equal(parsed.success, false);
  });
});
