/**
 * Shared allowlist-style URL guard used by anything that fetches a URL
 * supplied by an admin (custom model base URL, probe targets, etc.) so we
 * cannot be tricked into talking to internal infrastructure.
 *
 * This is intentionally conservative. DNS rebinding is still possible at
 * runtime (we cannot resolve at the edge without extra bindings), but
 * refusing obviously-internal URLs eliminates the easy SSRF paths.
 */
export function validateOutboundUrl(raw: string): { ok: true } | { ok: false; reason: string } {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return { ok: false, reason: "invalid URL" };
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return { ok: false, reason: `blocked scheme: ${parsed.protocol}` };
  }
  // Block http:// entirely — no plaintext to upstream providers.
  if (parsed.protocol === "http:") {
    return { ok: false, reason: "http:// not allowed; use https://" };
  }
  const host = parsed.hostname.toLowerCase();
  if (!host) return { ok: false, reason: "missing host" };

  const blockedHostnames = new Set([
    "localhost", "ip6-localhost", "ip6-loopback", "broadcasthost",
  ]);
  if (blockedHostnames.has(host)) return { ok: false, reason: "loopback host" };

  if (host.includes(":")) {
    if (host === "::1") return { ok: false, reason: "IPv6 loopback" };
    if (/^fe[89ab][0-9a-f]:/.test(host)) return { ok: false, reason: "IPv6 link-local" };
    if (/^f[cd][0-9a-f]{2}:/.test(host)) return { ok: false, reason: "IPv6 unique-local" };
    return { ok: true };
  }

  const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (ipv4) {
    const parts = ipv4.slice(1, 5).map((n) => Number.parseInt(n, 10));
    if (parts.some((n) => !Number.isFinite(n) || n < 0 || n > 255)) {
      return { ok: false, reason: "invalid IPv4" };
    }
    const [a, b] = parts as [number, number, number, number];
    if (a === 10) return { ok: false, reason: "RFC1918 10.0.0.0/8" };
    if (a === 127) return { ok: false, reason: "loopback 127.0.0.0/8" };
    if (a === 0) return { ok: false, reason: "0.0.0.0/8" };
    if (a === 169 && b === 254) return { ok: false, reason: "link-local 169.254/16 (incl. cloud metadata)" };
    if (a === 172 && b >= 16 && b <= 31) return { ok: false, reason: "RFC1918 172.16/12" };
    if (a === 192 && b === 168) return { ok: false, reason: "RFC1918 192.168/16" };
    if (a === 100 && b >= 64 && b <= 127) return { ok: false, reason: "CGNAT 100.64/10" };
    if (a >= 224) return { ok: false, reason: "reserved / multicast" };
  }

  return { ok: true };
}
