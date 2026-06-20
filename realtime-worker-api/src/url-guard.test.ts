import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { validateOutboundUrl } from "./url-guard";

describe("validateOutboundUrl", () => {
  it("allows public https URLs", () => {
    assert.equal(validateOutboundUrl("https://api.openai.com/v1").ok, true);
    assert.equal(validateOutboundUrl("https://generativelanguage.googleapis.com").ok, true);
  });

  it("blocks http scheme", () => {
    const r = validateOutboundUrl("http://api.example.com");
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.reason, /http/i);
  });

  it("blocks localhost hostnames", () => {
    assert.equal(validateOutboundUrl("https://localhost/path").ok, false);
    assert.equal(validateOutboundUrl("https://LOCALHOST").ok, false);
  });

  it("blocks 127.0.0.1 loopback", () => {
    const r = validateOutboundUrl("https://127.0.0.1/admin");
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.reason, /loopback/i);
  });

  it("blocks cloud metadata 169.254.169.254", () => {
    const r = validateOutboundUrl("https://169.254.169.254/latest/meta-data/");
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.reason, /169\.254/i);
  });

  it("blocks RFC1918 10.x", () => {
    assert.equal(validateOutboundUrl("https://10.0.0.1").ok, false);
    assert.equal(validateOutboundUrl("https://10.255.255.255").ok, false);
  });

  it("blocks RFC1918 192.168.x", () => {
    assert.equal(validateOutboundUrl("https://192.168.1.1").ok, false);
  });

  it("blocks RFC1918 172.16-31.x", () => {
    assert.equal(validateOutboundUrl("https://172.16.0.1").ok, false);
    assert.equal(validateOutboundUrl("https://172.31.255.255").ok, false);
    assert.equal(validateOutboundUrl("https://172.15.0.1").ok, true);
  });

  it("blocks IPv6 loopback", () => {
    assert.equal(validateOutboundUrl("https://[::1]/").ok, false);
  });

  it("rejects invalid URLs", () => {
    assert.equal(validateOutboundUrl("not-a-url").ok, false);
  });
});
