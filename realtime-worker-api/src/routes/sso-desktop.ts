import { eq } from "drizzle-orm";
import { auth } from "../auth";
import { getDb } from "../db";
import { verification } from "../db/schema";
import type { Env } from "../env";
import { escapeHtml } from "../lib/html";
import { jsonResponse } from "../lib/http";

const TICKET_PREFIX = "sso_desktop_ticket:";
const TICKET_TTL_SECONDS = 180;

const ALLOWED_WEB_CALLBACK_ORIGINS = new Set([
  "https://admin.copilot.vedgupta.in",
  "https://interview-copilot-admin.vedgupta.in",
  "https://copilot.vedgupta.in",
  "http://localhost:3000",
  "http://localhost:3001",
]);

export function resolveDesktopSsoCallbackUrl(
  mode: string | null,
  webCallback: string | null,
  baseURL: string,
): string {
  const defaultCallback = `${baseURL}/api/sso/desktop/complete`;
  if (mode !== "web" || !webCallback) {
    return defaultCallback;
  }
  try {
    const parsed = new URL(webCallback);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return defaultCallback;
    }
    const baseOrigin = new URL(baseURL).origin;
    if (
      ALLOWED_WEB_CALLBACK_ORIGINS.has(parsed.origin) ||
      parsed.origin === baseOrigin
    ) {
      return parsed.toString();
    }
  } catch {
    // Fall back to default desktop complete URL
  }
  return defaultCallback;
}

export function renderHtml(
  title: string,
  bodyHtml: string,
  status = 200,
): Response {
  const safeTitle = escapeHtml(title);
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${safeTitle}</title>
  <style>
    :root { color-scheme: dark; }
    body {
      margin: 0;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      background: #0a0a0a;
      color: #fafafa;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      padding: 24px;
    }
    .card {
      max-width: 420px;
      width: 100%;
      background: #141414;
      border: 1px solid #262626;
      border-radius: 16px;
      padding: 32px 28px;
      text-align: center;
      box-shadow: 0 20px 50px rgba(0, 0, 0, 0.5);
    }
    h1 { font-size: 20px; font-weight: 600; margin: 0 0 8px; }
    p { font-size: 14px; color: #a3a3a3; line-height: 1.5; margin: 0 0 20px; }
    .btn {
      display: inline-block;
      background: #fafafa;
      color: #0a0a0a;
      font-weight: 600;
      font-size: 14px;
      padding: 11px 20px;
      border-radius: 10px;
      text-decoration: none;
      transition: opacity 0.15s;
    }
    .btn:hover { opacity: 0.9; }
    .code-box {
      margin-top: 20px;
      padding-top: 16px;
      border-top: 1px solid #262626;
      font-size: 12px;
      color: #737373;
    }
    code {
      display: block;
      margin-top: 8px;
      padding: 8px 10px;
      background: #0a0a0a;
      border: 1px solid #262626;
      border-radius: 8px;
      color: #e5e5e5;
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      word-break: break-all;
      user-select: all;
    }
  </style>
</head>
<body>
  <div class="card">
    ${bodyHtml}
  </div>
</body>
</html>`;
  return new Response(html, {
    status,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

export async function handleDesktopSsoStart(
  request: Request,
  env: Env,
): Promise<Response> {
  const baseURL = (
    env.BETTER_AUTH_URL || "https://realtime-worker-api-prod.vedgupta.in"
  ).replace(/\/$/, "");
  const reqUrl = new URL(request.url);
  const mode = reqUrl.searchParams.get("mode");
  const webCallback = reqUrl.searchParams.get("callbackURL");

  const callbackURL = resolveDesktopSsoCallbackUrl(mode, webCallback, baseURL);

  const internalReq = new Request(`${baseURL}/api/auth/sign-in/social`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: baseURL,
    },
    body: JSON.stringify({
      provider: "vedgupta-sso",
      callbackURL,
    }),
  });

  const res = await auth(env).handler(internalReq);
  if (!res.ok) {
    const errText = escapeHtml(
      await res.text().catch(() => "Failed to start SSO"),
    );
    return renderHtml(
      "Sign-in Error",
      `<h1>Could not start VedGupta SSO</h1><p>${errText}</p><a class="btn" href="${escapeHtml(baseURL)}/api/sso/desktop/start">Try Again</a>`,
      500,
    );
  }

  const data = (await res.json()) as { url?: string };
  if (!data.url) {
    return renderHtml(
      "Sign-in Error",
      `<h1>Invalid SSO redirect</h1><p>No authorization URL was returned.</p>`,
      500,
    );
  }

  const headers = new Headers();
  headers.set("Location", data.url);
  headers.set("Cache-Control", "no-store");
  const setCookie = res.headers.get("set-cookie");
  if (setCookie) {
    headers.set("Set-Cookie", setCookie);
  }

  return new Response(null, { status: 302, headers });
}

export async function handleDesktopSsoComplete(
  request: Request,
  env: Env,
): Promise<Response> {
  const baseURL = (
    env.BETTER_AUTH_URL || "https://realtime-worker-api-prod.vedgupta.in"
  ).replace(/\/$/, "");
  const reqUrl = new URL(request.url);
  const errorParam = reqUrl.searchParams.get("error");
  if (errorParam) {
    const desc = escapeHtml(
      reqUrl.searchParams.get("error_description") ||
        "Your account requires approval on sso.vedgupta.in before signing in.",
    );
    return renderHtml(
      "Access Pending Approval",
      `<h1>Access Pending Approval</h1>
       <p>${desc}</p>
       <a class="btn" href="https://sso.vedgupta.in/pending">Check Status on VedGupta SSO</a>`,
      400,
    );
  }

  const session = await auth(env).api.getSession({ headers: request.headers });
  if (!session?.session?.token || !session?.user) {
    return renderHtml(
      "Sign-in Incomplete",
      `<h1>Sign-in session not found</h1>
       <p>Please complete sign-in on VedGupta SSO and ensure your account is approved.</p>
       <a class="btn" href="${escapeHtml(baseURL)}/api/sso/desktop/start">Sign in with VedGupta SSO</a>`,
      401,
    );
  }

  const sessionUser = session.user as {
    id: string;
    email: string;
    isBanned?: boolean | null;
    banned?: boolean | null;
  };
  if (sessionUser.isBanned === true || sessionUser.banned === true) {
    return renderHtml(
      "Account Suspended",
      `<h1>Account Suspended</h1>
       <p>Your account has been suspended. Please contact an administrator if you believe this is an error.</p>`,
      403,
    );
  }

  const ticket = crypto.randomUUID();
  const payload = JSON.stringify({
    token: session.session.token,
    userId: session.user.id,
  });

  if (env.CONFIG_KV) {
    await env.CONFIG_KV.put(`${TICKET_PREFIX}${ticket}`, payload, {
      expirationTtl: TICKET_TTL_SECONDS,
    });
  } else {
    const db = getDb(env);
    const now = new Date();
    await db.insert(verification).values({
      id: crypto.randomUUID(),
      identifier: `${TICKET_PREFIX}${ticket}`,
      value: payload,
      expiresAt: new Date(now.getTime() + TICKET_TTL_SECONDS * 1000),
      createdAt: now,
      updatedAt: now,
    });
  }

  const deepLink = `realtime-copilot://auth-callback?ticket=${encodeURIComponent(ticket)}`;
  const safeEmail = escapeHtml(session.user.email);

  return renderHtml(
    "Signed in to Realtime Interview Copilot",
    `<h1>Signed in as ${safeEmail}</h1>
     <p>Redirecting back to the Realtime Interview Copilot desktop app…</p>
     <a class="btn" href="${deepLink}">Open Realtime Interview Copilot</a>
     <div class="code-box">
       If the desktop app did not open automatically, paste this one-time sign-in code in the app:
       <code>${escapeHtml(ticket)}</code>
     </div>
     <script>
       window.location.href = ${JSON.stringify(deepLink)};
     </script>`,
  );
}

export async function handleDesktopSsoExchange(
  request: Request,
  env: Env,
): Promise<Response> {
  let body: { ticket?: string } = {};
  try {
    body = (await request.json()) as { ticket?: string };
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, 400);
  }

  const ticket = body.ticket?.trim();
  if (!ticket || ticket.length < 10) {
    return jsonResponse({ error: "Missing or invalid ticket" }, 400);
  }

  const key = `${TICKET_PREFIX}${ticket}`;
  let rawPayload: string | null = null;

  if (env.CONFIG_KV) {
    rawPayload = await env.CONFIG_KV.get(key);
    if (rawPayload) {
      await env.CONFIG_KV.delete(key);
    }
  }

  if (!rawPayload) {
    const db = getDb(env);
    const rows = await db
      .select()
      .from(verification)
      .where(eq(verification.identifier, key))
      .limit(1);
    const row = rows[0];
    if (row) {
      await db.delete(verification).where(eq(verification.id, row.id));
      if (row.expiresAt.getTime() > Date.now()) {
        rawPayload = row.value;
      }
    }
  }

  if (!rawPayload) {
    return jsonResponse({ error: "Sign-in ticket expired or already used" }, 401);
  }

  const parsed = JSON.parse(rawPayload) as { token: string; userId: string };
  return jsonResponse({ token: parsed.token, userId: parsed.userId }, 200);
}
