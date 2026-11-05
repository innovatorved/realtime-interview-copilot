import { eq } from "drizzle-orm";
import { auth } from "../auth";
import { getDb } from "../db";
import { user, verification } from "../db/schema";
import type { Env } from "../env";
import { escapeHtml } from "../lib/html";
import { jsonResponse } from "../lib/http";

const TICKET_PREFIX = "sso_desktop_ticket:";
const TICKET_TTL_SECONDS = 180;

const ALLOWED_WEB_CALLBACK_ORIGINS = new Set([
  "https://admin.copilot.vedgupta.in",
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
  const year = new Date().getFullYear();
  const vLogoSvg = `<svg width="22" height="22" viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M16 18 L32 48 L48 18" stroke="currentColor" stroke-width="6.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

  const html = `<!DOCTYPE html>
<html lang="en" data-theme="dark">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${safeTitle} — Ved Gupta SSO</title>
  <style>
    :root, [data-theme="dark"] {
      color-scheme: dark;
      --canvas: #000000;
      --surface: #0a0a0a;
      --surface-elevated: #111111;
      --surface-card: #171717;
      --surface-active: #262626;
      --hairline: #262626;
      --hairline-soft: #171717;
      --hairline-strong: #404040;
      --ink: #ffffff;
      --body: #e5e5e5;
      --mute: #a1a1a1;
      --ash: #8f8f8f;
      --primary: #ffffff;
      --primary-pressed: #e5e5e5;
      --on-primary: #000000;
      --accent-green: #05df72;
      --accent-green-soft: rgba(5, 223, 114, 0.10);
      --accent-green-border: rgba(5, 223, 114, 0.32);
      --accent-yellow: #ffd236;
      --accent-yellow-soft: rgba(255, 210, 54, 0.10);
      --accent-yellow-border: rgba(255, 210, 54, 0.32);
      --accent-red: #fb2c36;
      --accent-red-soft: rgba(251, 44, 54, 0.11);
      --accent-red-border: rgba(251, 44, 54, 0.32);
      --grid-line: rgba(255, 255, 255, 0.04);
      --font-sans: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
      --font-mono: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
    }
    *, *::before, *::after { box-sizing: border-box; }
    html, body {
      margin: 0;
      padding: 0;
      min-height: 100dvh;
      background: var(--canvas);
      color: var(--ink);
      font-family: var(--font-sans);
      font-size: 13px;
      line-height: 1.5;
      -webkit-font-smoothing: antialiased;
      -moz-osx-font-smoothing: grayscale;
    }
    .hero-grid-bg {
      background-image:
        linear-gradient(to right, var(--grid-line) 1px, transparent 1px),
        linear-gradient(to bottom, var(--grid-line) 1px, transparent 1px);
      background-size: 40px 40px;
    }
    .auth-shell {
      min-height: 100dvh;
      display: flex;
      flex-direction: column;
    }
    .marketing-col {
      display: none;
      flex-direction: column;
      justify-content: space-between;
      padding: 48px;
      background: rgba(10, 10, 10, 0.92);
      border-right: 1px solid var(--hairline);
    }
    .main-col {
      flex: 1;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 32px 16px;
    }
    .mobile-brand {
      margin-bottom: 24px;
      display: flex;
      justify-content: center;
    }
    @media (min-width: 1024px) {
      .auth-shell {
        display: grid;
        grid-template-columns: minmax(0, 1fr) minmax(36rem, 52%);
        height: 100dvh;
        overflow: hidden;
      }
      .marketing-col {
        display: flex;
        padding: 64px 72px;
      }
      .main-col {
        padding: 40px 48px;
        overflow-y: auto;
      }
      .mobile-brand {
        display: none;
      }
    }
    .logo-lockup {
      display: flex;
      align-items: center;
      gap: 12px;
      margin-bottom: 40px;
      text-decoration: none;
      color: inherit;
    }
    .logo-mark {
      width: 40px;
      height: 40px;
      border-radius: 8px;
      background: var(--surface-elevated);
      border: 1px solid var(--hairline-strong);
      color: var(--ink);
      display: inline-flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
    }
    .logo-title {
      font-size: 16px;
      font-weight: 600;
      letter-spacing: -0.02em;
      color: var(--ink);
      margin: 0;
      line-height: 1.2;
    }
    .logo-sub {
      font-family: var(--font-mono);
      font-size: 10px;
      color: var(--ash);
      letter-spacing: 0.06em;
      text-transform: uppercase;
      margin: 2px 0 0;
    }
    .eco-pill {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 2px 8px;
      border-radius: 9999px;
      font-family: var(--font-mono);
      font-size: 10.5px;
      font-weight: 500;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      border: 1px solid var(--hairline);
      background: var(--surface);
      color: var(--mute);
      white-space: nowrap;
    }
    .eco-pill--green {
      color: var(--accent-green);
      border-color: var(--accent-green-border);
      background: var(--accent-green-soft);
    }
    .eco-pill--amber {
      color: var(--accent-yellow);
      border-color: var(--accent-yellow-border);
      background: var(--accent-yellow-soft);
    }
    .eco-pill--red {
      color: var(--accent-red);
      border-color: var(--accent-red-border);
      background: var(--accent-red-soft);
    }
    .eco-dot {
      width: 6px;
      height: 6px;
      border-radius: 9999px;
      background: currentColor;
    }
    .mkt-headline {
      font-size: clamp(28px, 3vw, 41px);
      font-weight: 600;
      letter-spacing: -0.03em;
      line-height: 1.1;
      margin: 16px 0;
      color: var(--ink);
    }
    .mkt-desc {
      font-size: 15px;
      color: var(--mute);
      line-height: 1.6;
      margin: 0;
      max-width: 34rem;
    }
    .mkt-footer {
      display: flex;
      flex-direction: column;
      gap: 10px;
    }
    .mono-link {
      font-family: var(--font-mono);
      font-size: 11px;
      color: var(--mute);
      text-decoration: underline;
      text-decoration-color: var(--hairline-strong);
      text-underline-offset: 4px;
      transition: color 0.15s;
    }
    .mono-link:hover { color: var(--ink); }
    .copyright {
      font-family: var(--font-mono);
      font-size: 11px;
      color: var(--ash);
      margin: 0;
    }
    .card {
      max-width: 36rem;
      width: 100%;
      background: var(--surface);
      border: 1px solid var(--hairline-strong);
      border-radius: 12px;
      padding: 32px;
      box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.75);
    }
    .card-header {
      margin-bottom: 20px;
    }
    .card-badge-row {
      margin-bottom: 10px;
    }
    h1 {
      font-size: 20px;
      font-weight: 600;
      letter-spacing: -0.03em;
      color: var(--ink);
      margin: 0 0 6px;
      line-height: 1.25;
    }
    p {
      font-size: 13px;
      color: var(--mute);
      line-height: 1.55;
      margin: 0 0 16px;
    }
    .identity-panel {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding: 12px 14px;
      border-radius: 6px;
      border: 1px solid var(--hairline);
      background: var(--surface-elevated);
      margin-bottom: 16px;
    }
    .identity-meta {
      min-width: 0;
    }
    .identity-label {
      font-family: var(--font-mono);
      font-size: 10px;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--ash);
      margin: 0 0 2px;
    }
    .identity-email {
      font-size: 13px;
      font-weight: 500;
      color: var(--ink);
      margin: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      width: 100%;
      height: 36px;
      background: var(--primary);
      color: var(--on-primary);
      font-weight: 500;
      font-size: 13px;
      padding: 0 16px;
      border-radius: 6px;
      border: 1px solid transparent;
      text-decoration: none;
      cursor: pointer;
      transition: background-color 0.15s, opacity 0.15s;
    }
    .btn:hover { background: var(--primary-pressed); }
    .btn-outline {
      background: var(--surface-elevated);
      color: var(--body);
      border-color: var(--hairline-strong);
      width: auto;
      height: 38px;
      padding: 0 14px;
      font-family: var(--font-mono);
      font-size: 11px;
      flex-shrink: 0;
    }
    .btn-outline:hover {
      background: var(--surface-active);
      color: var(--ink);
    }
    .code-box {
      margin-top: 20px;
      padding-top: 18px;
      border-top: 1px solid var(--hairline);
    }
    .field-label {
      display: block;
      font-family: var(--font-mono);
      font-size: 11px;
      font-weight: 500;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      color: var(--body);
      margin-bottom: 4px;
    }
    .field-hint {
      font-size: 12px;
      color: var(--ash);
      margin: 0 0 10px;
      line-height: 1.45;
    }
    .code-row {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    code {
      flex: 1;
      display: flex;
      align-items: center;
      height: 38px;
      padding: 0 12px;
      background: var(--surface-elevated);
      border: 1px solid var(--hairline-strong);
      border-radius: 6px;
      color: var(--ink);
      font-family: var(--font-mono);
      font-size: 12.5px;
      white-space: nowrap;
      overflow-x: auto;
      user-select: all;
    }
    .card-footer {
      max-width: 36rem;
      width: 100%;
      margin-top: 20px;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 16px;
      text-align: center;
    }
    .consumed-note {
      display: none;
      align-items: center;
      justify-content: center;
      gap: 6px;
      margin-top: 12px;
      color: var(--ash);
      font-family: var(--font-mono);
      font-size: 11px;
    }
    .fallback-toggle {
      display: inline-block;
      margin-top: 14px;
      background: none;
      border: none;
      padding: 0;
      font-family: var(--font-mono);
      font-size: 11px;
      color: var(--mute);
      text-decoration: underline;
      text-decoration-color: var(--hairline-strong);
      text-underline-offset: 4px;
      cursor: pointer;
    }
    .fallback-toggle:hover {
      color: var(--ink);
    }
  </style>
</head>
<body class="hero-grid-bg">
  <div class="auth-shell">
    <aside class="marketing-col">
      <div>
        <a href="https://sso.vedgupta.in" class="logo-lockup">
          <span class="logo-mark">${vLogoSvg}</span>
          <div>
            <p class="logo-title">Ved Gupta</p>
            <p class="logo-sub">SSO Identity</p>
          </div>
        </a>
        <div>
          <span class="eco-pill eco-pill--green">
            <span class="eco-dot"></span>
            Single sign-on
          </span>
        </div>
        <h2 class="mkt-headline">One account for every service.</h2>
        <p class="mkt-desc">
          Sign in with your Ved Gupta SSO credentials. Manage connected applications, security keys, and active sessions in one place.
        </p>
      </div>
      <div class="mkt-footer">
        <a href="https://vedgupta.in" class="mono-link">vedgupta.in →</a>
        <p class="copyright">© ${year} Ved Prakash Gupta</p>
      </div>
    </aside>
    <main class="main-col">
      <div class="mobile-brand">
        <span class="logo-mark">${vLogoSvg}</span>
      </div>
      <div class="card">
        ${bodyHtml}
      </div>
      <div class="card-footer">
        <a href="https://sso.vedgupta.in/account" class="mono-link">Account portal</a>
        <span style="color: var(--hairline-strong)">·</span>
        <a href="https://sso.vedgupta.in" class="mono-link">sso.vedgupta.in</a>
      </div>
    </main>
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
      `<div class="card-header">
         <div class="card-badge-row">
           <span class="eco-pill eco-pill--red"><span class="eco-dot"></span>Sign-in error</span>
         </div>
         <h1>Could not start VedGupta SSO</h1>
         <p style="margin-bottom:0">${errText}</p>
       </div>
       <a class="btn" href="${escapeHtml(baseURL)}/api/sso/desktop/start">Try Again</a>`,
      500,
    );
  }

  const data = (await res.json()) as { url?: string };
  if (!data.url) {
    return renderHtml(
      "Sign-in Error",
      `<div class="card-header">
         <div class="card-badge-row">
           <span class="eco-pill eco-pill--red"><span class="eco-dot"></span>Sign-in error</span>
         </div>
         <h1>Invalid SSO redirect</h1>
         <p style="margin-bottom:0">No authorization URL was returned.</p>
       </div>`,
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
        "Your account requires administrator approval before signing in.",
    );
    return renderHtml(
      "Access Pending Approval",
      `<div class="card-header">
         <div class="card-badge-row">
           <span class="eco-pill eco-pill--amber"><span class="eco-dot"></span>Pending approval</span>
         </div>
         <h1>Access Pending Approval</h1>
         <p style="margin-bottom:0">${desc}</p>
       </div>
       <a class="btn" href="${escapeHtml(baseURL)}/api/sso/desktop/start">Try Again</a>`,
      400,
    );
  }

  const session = await auth(env).api.getSession({ headers: request.headers });
  if (!session?.session?.token || !session?.user) {
    return renderHtml(
      "Sign-in Incomplete",
      `<div class="card-header">
         <div class="card-badge-row">
           <span class="eco-pill eco-pill--amber"><span class="eco-dot"></span>Session required</span>
         </div>
         <h1>Sign-in session not found</h1>
         <p style="margin-bottom:0">Please complete sign-in on VedGupta SSO and ensure your account is approved.</p>
       </div>
       <a class="btn" href="${escapeHtml(baseURL)}/api/sso/desktop/start">Sign in with VedGupta SSO</a>`,
      401,
    );
  }

  const sessionUser = session.user as {
    id: string;
    email: string;
    role?: string | null;
    isApproved?: boolean | null;
    approved?: boolean | null;
    isBanned?: boolean | null;
    banned?: boolean | null;
  };
  if (sessionUser.isBanned === true || sessionUser.banned === true) {
    return renderHtml(
      "Account Suspended",
      `<div class="card-header">
         <div class="card-badge-row">
           <span class="eco-pill eco-pill--red"><span class="eco-dot"></span>Account suspended</span>
         </div>
         <h1>Account Suspended</h1>
         <p style="margin-bottom:0">Your account has been suspended. Please contact an administrator if you believe this is an error.</p>
       </div>`,
      403,
    );
  }

  const isPrimaryAdmin =
    sessionUser.email?.toLowerCase() === "admin@vedgupta.in" ||
    (env.ADMIN_EMAILS ?? "")
      .split(",")
      .map((e) => e.trim().toLowerCase())
      .includes(sessionUser.email?.toLowerCase() ?? "");

  let isApproved =
    isPrimaryAdmin ||
    sessionUser.role === "admin" ||
    sessionUser.isApproved === true ||
    sessionUser.approved === true;

  if (!isApproved && env.DB) {
    try {
      const [u] = await getDb(env)
        .select({ isApproved: user.isApproved, role: user.role })
        .from(user)
        .where(eq(user.id, sessionUser.id))
        .limit(1);
      if (u) {
        isApproved = isPrimaryAdmin || u.role === "admin" || u.isApproved === true;
      }
    } catch {
      /* ignore */
    }
  }

  const ticket = crypto.randomUUID();
  const payload = JSON.stringify({
    token: session.session.token,
    userId: session.user.id,
  });

  // Always store in strongly-consistent D1 so atomic DELETE ... RETURNING
  // guarantees strict single-use consumption across all edge locations.
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

  const deepLink = `realtime-copilot://auth-callback?ticket=${encodeURIComponent(ticket)}`;
  const safeEmail = escapeHtml(session.user.email);

  const statusPillClass = isApproved ? "eco-pill--green" : "eco-pill--amber";
  const statusPillText = isApproved ? "Authenticated" : "Pending approval";
  const headingText = isApproved
    ? "Signed in to Realtime Interview Copilot"
    : "Account Pending Approval";
  const subtextText = isApproved
    ? "Redirecting back to the Realtime Interview Copilot desktop app…"
    : "Redirecting back to the Realtime Interview Copilot desktop app to wait for administrator approval…";

  return renderHtml(
    headingText,
    `<div class="card-header">
       <div class="card-badge-row">
         <span class="eco-pill ${statusPillClass}" id="auth-status-pill"><span class="eco-dot"></span><span id="auth-status-text">${statusPillText}</span></span>
       </div>
       <h1 id="auth-heading">${headingText}</h1>
       <p id="auth-subtext" style="margin-bottom:0">${subtextText}</p>
     </div>
     <div class="identity-panel">
       <div class="identity-meta">
         <p class="identity-label">Signed in as</p>
         <p class="identity-email">${safeEmail}</p>
       </div>
       <a class="mono-link" href="${escapeHtml(baseURL)}/api/sso/desktop/start">Switch account</a>
     </div>
     <a class="btn" id="open-app-btn" href="${deepLink}">Open Realtime Interview Copilot</a>
     <div style="text-align:center" id="fallback-toggle-wrap">
       <button type="button" class="fallback-toggle" id="fallback-toggle-btn">App didn't open? Use one-time sign-in code</button>
     </div>
     <div class="code-box" id="code-box" style="display:none">
       <div class="code-row" id="code-row">
         <code id="sso-ticket"></code>
         <button type="button" class="btn btn-outline" id="copy-ticket-btn">Copy</button>
       </div>
     </div>
     <div class="consumed-note" id="consumed-note">
       <span>Desktop app connected · One-time code used</span>
     </div>
     <script>
       (function () {
         var rawTicket = ${JSON.stringify(ticket)};
         var consumed = false;
         var toggleWrap = document.getElementById("fallback-toggle-wrap");
         var toggleBtn = document.getElementById("fallback-toggle-btn");
         var codeBox = document.getElementById("code-box");
         var copyBtn = document.getElementById("copy-ticket-btn");
         var codeEl = document.getElementById("sso-ticket");
         var consumedNote = document.getElementById("consumed-note");
         var openAppBtn = document.getElementById("open-app-btn");
         var subtextEl = document.getElementById("auth-subtext");
         var statusTextEl = document.getElementById("auth-status-text");

         function markConsumed() {
           if (consumed) return;
           consumed = true;
           rawTicket = "";
           if (codeEl) codeEl.textContent = "";
           if (codeBox) codeBox.style.display = "none";
           if (toggleWrap) toggleWrap.style.display = "none";
           if (openAppBtn) openAppBtn.style.display = "none";
           if (consumedNote) consumedNote.style.display = "flex";
           if (subtextEl) {
             subtextEl.textContent = "Your desktop app is signed in. You can close this tab.";
           }
           if (statusTextEl) {
             statusTextEl.textContent = "Connected";
           }
         }

         if (toggleBtn && codeBox && codeEl) {
           toggleBtn.addEventListener("click", function () {
             if (consumed || !rawTicket) return;
             codeEl.textContent = rawTicket;
             codeBox.style.display = "block";
             if (toggleWrap) toggleWrap.style.display = "none";
           });
         }

         if (copyBtn) {
           copyBtn.addEventListener("click", function () {
             if (consumed || !rawTicket) return;
             if (navigator.clipboard && navigator.clipboard.writeText) {
               navigator.clipboard.writeText(rawTicket).then(function () {
                 copyBtn.textContent = "Copied";
                 setTimeout(function () { copyBtn.textContent = "Copy"; }, 1800);
               });
             }
           });
         }

         var pollCount = 0;
         var pollTimer = setInterval(function () {
           if (consumed || !rawTicket || pollCount >= 20) {
             clearInterval(pollTimer);
             return;
           }
           pollCount++;
           fetch("/api/sso/desktop/exchange?ticket=" + encodeURIComponent(rawTicket), {
             method: "GET",
             cache: "no-store"
           })
             .then(function (r) { return r.json(); })
             .then(function (data) {
               if (data && data.consumed === true) {
                 markConsumed();
                 clearInterval(pollTimer);
               }
             })
             .catch(function () {});
         }, 3000);

         window.location.href = ${JSON.stringify(deepLink)};
       })();
     </script>`,
  );
}

export async function handleDesktopSsoExchange(
  request: Request,
  env: Env,
): Promise<Response> {
  if (request.method === "GET") {
    const reqUrl = new URL(request.url);
    const ticket = reqUrl.searchParams.get("ticket")?.trim();
    if (!ticket || ticket.length < 10) {
      return jsonResponse({ consumed: true }, 200);
    }
    const key = `${TICKET_PREFIX}${ticket}`;
    const db = getDb(env);
    const rows = await db
      .select({ expiresAt: verification.expiresAt })
      .from(verification)
      .where(eq(verification.identifier, key))
      .limit(1);
    const row = rows[0];
    const isAvailable = Boolean(row && row.expiresAt.getTime() > Date.now());
    return jsonResponse({ consumed: !isAvailable }, 200);
  }

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

  const db = getDb(env);
  const deletedRows = await db
    .delete(verification)
    .where(eq(verification.identifier, key))
    .returning({
      value: verification.value,
      expiresAt: verification.expiresAt,
    });
  const row = deletedRows[0];
  if (row && row.expiresAt.getTime() > Date.now()) {
    rawPayload = row.value;
  }

  if (env.CONFIG_KV) {
    await env.CONFIG_KV.delete(key).catch(() => {});
  }

  if (!rawPayload) {
    return jsonResponse({ error: "Sign-in ticket expired or already used" }, 401);
  }

  const parsed = JSON.parse(rawPayload) as { token: string; userId: string };
  return jsonResponse({ token: parsed.token, userId: parsed.userId }, 200);
}
