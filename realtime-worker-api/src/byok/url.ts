/**
 * URL validation for user-supplied BYOK provider URLs.
 *
 * Stricter than the admin-side `validateOutboundUrl` because:
 *   1. Deepgram realtime needs `wss://`, but OpenAI-compatible never does.
 *   2. The hostname is what we whitelist in the Electron renderer's CSP,
 *      so we want a normalised lowercase value with no port surprises.
 *   3. Path/query are forbidden — only `https://host[:port]` style bases.
 *
 * Returns the normalised URL string + extracted hostname on success.
 */

export type Provider = "deepgram" | "openai";

export interface ValidatedUrl {
  url: string;
  host: string;
  protocol: "https:" | "wss:";
}

const MAX_URL_LEN = 256;

const BLOCKED_HOSTS = new Set([
  "localhost",
  "ip6-localhost",
  "ip6-loopback",
  "broadcasthost",
]);

function isPrivateIPv4(host: string): boolean {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!m) return false;
  const parts = m.slice(1, 5).map((n) => Number.parseInt(n, 10));
  if (parts.some((n) => !Number.isFinite(n) || n < 0 || n > 255)) return true;
  const [a, b] = parts as [number, number, number, number];
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 0) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a >= 224) return true;
  return false;
}

function isPrivateIPv6(host: string): boolean {
  if (host === "::1") return true;
  if (/^fe[89ab][0-9a-f]:/i.test(host)) return true;
  if (/^f[cd][0-9a-f]{2}:/i.test(host)) return true;
  return false;
}

export function validateProviderUrl(
  rawUrl: string,
  provider: Provider,
): { ok: true; data: ValidatedUrl } | { ok: false; reason: string } {
  if (typeof rawUrl !== "string" || rawUrl.length === 0) {
    return { ok: false, reason: "URL is required" };
  }
  if (rawUrl.length > MAX_URL_LEN) {
    return { ok: false, reason: `URL too long (max ${MAX_URL_LEN})` };
  }

  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return { ok: false, reason: "Invalid URL" };
  }

  const allowed = provider === "deepgram" ? ["https:", "wss:"] : ["https:"];
  if (!allowed.includes(parsed.protocol)) {
    return {
      ok: false,
      reason: `Protocol must be ${allowed.join(" or ")} (got ${parsed.protocol})`,
    };
  }

  // Disallow path/query/fragment to keep it a clean base URL — strip
  // trailing slashes only.
  if (parsed.search || parsed.hash) {
    return { ok: false, reason: "URL must not include query or fragment" };
  }

  const host = parsed.hostname.toLowerCase();
  if (!host) return { ok: false, reason: "Missing host" };
  if (BLOCKED_HOSTS.has(host)) return { ok: false, reason: "Loopback host not allowed" };
  if (host.includes(":") && isPrivateIPv6(host)) {
    return { ok: false, reason: "Private/link-local IPv6 not allowed" };
  }
  if (isPrivateIPv4(host)) {
    return { ok: false, reason: "Private/loopback IPv4 not allowed" };
  }

  // Rebuild the URL to canonicalise (drops default port, lowercases host,
  // strips trailing slash on root path).
  const portPart = parsed.port ? `:${parsed.port}` : "";
  const pathPart = parsed.pathname.replace(/\/+$/, "");
  const normalised = `${parsed.protocol}//${host}${portPart}${pathPart}`;

  return {
    ok: true,
    data: {
      url: normalised,
      host,
      protocol: parsed.protocol as "https:" | "wss:",
    },
  };
}
