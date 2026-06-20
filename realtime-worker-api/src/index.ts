/** Worker entrypoint — pure dispatcher.
 *
 *  Owns: method/path → handler routing, CORS, CSRF origin gate, and the
 *  fallthrough Better Auth handler at `/api/auth/*`. Every concrete
 *  business handler lives under `routes/`; cross-cutting concerns live
 *  under `middleware/` and `lib/`. */

import { auth } from "./auth";
import { handleOptions, withCors } from "./middleware/cors";
import { csrfCheck } from "./middleware/csrf";
import { jsonResponse } from "./lib/http";
import { getDb } from "./db";
import { recordSecurityEvent } from "./lib/security-log";
import { handleHealth } from "./routes/health";
import { handleDeepgram, handleDeepgramAsk } from "./routes/deepgram";
import { handleCompletion } from "./routes/completion";
import {
  handleCreateNote,
  handleDeleteNote,
  handleGetNotes,
} from "./routes/notes";
import {
  handleGetInterviewContext,
  handlePatchInterviewContext,
} from "./routes/interview-context";
import { handleExport } from "./routes/export";
import { handleUsageMe } from "./routes/usage-me";
import {
  handleSessionEnd,
  handleSessionEndAll,
  handleSessionStart,
} from "./routes/sessions";
import { handleEventTrack } from "./routes/events";
import {
  handleCreateSupportMessage,
  handleListSupportMessages,
  handleMarkSupportThreadReadByUser,
} from "./routes/support";
import {
  handleAckAnnouncement,
  handleActiveAnnouncements,
  handleDismissAnnouncement,
} from "./routes/announcements";
import type { Env } from "./env";
import { runScheduledMaintenance } from "./lib/maintenance";

export default {
  async scheduled(
    _controller: ScheduledController,
    env: Env,
    _ctx: ExecutionContext,
  ) {
    try {
      const result = await runScheduledMaintenance(env);
      console.log("[Worker] Scheduled maintenance complete:", result.cleanedAt);
    } catch (e) {
      console.error(
        "[Worker] Scheduled maintenance failed:",
        e instanceof Error ? e.message : "unknown",
      );
    }
  },

  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/$/, "");

    if (request.method === "OPTIONS") {
      return handleOptions(request);
    }

    const csrfFailure = csrfCheck(request);
    if (csrfFailure) {
      ctx.waitUntil(
        recordSecurityEvent(getDb(env), {
          eventType: "csrf_blocked",
          action: csrfFailure,
          ipAddress: request.headers.get("CF-Connecting-IP"),
          metadata: { path, method: request.method },
        }),
      );
      return withCors(
        jsonResponse(
          {
            error:
              csrfFailure === "missing_client_header"
                ? "Missing client header"
                : "Forbidden origin",
          },
          403,
        ),
        request,
      );
    }

    if (path === "/api/health" && request.method === "GET") {
      const response = await handleHealth(request, env);
      return withCors(response, request);
    }

    if (
      (request.method === "POST" || request.method === "GET") &&
      (path === "/api/deepgram" || path === "/deepgram")
    ) {
      const response = await handleDeepgram(request, env, ctx);
      return withCors(response, request);
    }

    // Ask AI mic-only Deepgram key. Distinct from /api/deepgram because the
    // Ask AI mic flow is ad-hoc (not tied to a live_session row) — we still
    // require auth + rate-limit + short TTL so the project key can never be
    // minted for anonymous callers.
    if (
      request.method === "GET" &&
      (path === "/api/deepgram/ask" || path === "/deepgram/ask")
    ) {
      const response = await handleDeepgramAsk(request, env, ctx);
      return withCors(response, request);
    }

    if (
      request.method === "POST" &&
      (path === "/api/completion" || path === "/completion")
    ) {
      const response = await handleCompletion(request, env, ctx);
      return withCors(response, request);
    }

    if (path === "/api/notes" && request.method === "GET") {
      const response = await handleGetNotes(request, env, ctx, url);
      return withCors(response, request);
    }
    if (path === "/api/notes" && request.method === "POST") {
      const response = await handleCreateNote(request, env, ctx);
      return withCors(response, request);
    }
    if (path.match(/^\/api\/notes\/[^/]+$/) && request.method === "DELETE") {
      const noteId = path.split("/").pop()!;
      const response = await handleDeleteNote(request, env, ctx, noteId);
      return withCors(response, request);
    }

    if (path === "/api/interview-context" && request.method === "GET") {
      const response = await handleGetInterviewContext(request, env, ctx);
      return withCors(response, request);
    }
    if (path === "/api/interview-context" && request.method === "PATCH") {
      const response = await handlePatchInterviewContext(request, env, ctx);
      return withCors(response, request);
    }

    if (path === "/api/export" && request.method === "POST") {
      const response = await handleExport(request, env, ctx);
      return withCors(response, request);
    }

    if (path === "/api/usage/me" && request.method === "GET") {
      const response = await handleUsageMe(request, env, ctx, url);
      return withCors(response, request);
    }

    if (path === "/api/sessions/start" && request.method === "POST") {
      const response = await handleSessionStart(request, env, ctx);
      return withCors(response, request);
    }
    if (path === "/api/sessions/end" && request.method === "POST") {
      const response = await handleSessionEnd(request, env, ctx);
      return withCors(response, request);
    }
    // Bulk-end: client uses this to recover from a "you already have N
    // active sessions" 409 caused by an earlier hard-killed process whose
    // end ping never fired. Always idempotent.
    if (path === "/api/sessions/end-all" && request.method === "POST") {
      const response = await handleSessionEndAll(request, env, ctx);
      return withCors(response, request);
    }
    if (path === "/api/events/track" && request.method === "POST") {
      const response = await handleEventTrack(request, env, ctx);
      return withCors(response, request);
    }

    // Support messages (pending or approved users).
    if (path === "/api/support/messages" && request.method === "GET") {
      const response = await handleListSupportMessages(request, env);
      return withCors(response, request);
    }
    if (path === "/api/support/messages" && request.method === "POST") {
      const response = await handleCreateSupportMessage(request, env, ctx);
      return withCors(response, request);
    }
    if (path === "/api/support/messages/read" && request.method === "POST") {
      const response = await handleMarkSupportThreadReadByUser(request, env);
      return withCors(response, request);
    }

    // Announcements (banners / popups).
    if (path === "/api/announcements/active" && request.method === "GET") {
      const response = await handleActiveAnnouncements(request, env, ctx);
      return withCors(response, request);
    }
    {
      const m = path.match(/^\/api\/announcements\/([^/]+)\/dismiss$/);
      if (m && request.method === "POST") {
        const response = await handleDismissAnnouncement(
          request,
          env,
          ctx,
          m[1],
        );
        return withCors(response, request);
      }
    }
    {
      const m = path.match(/^\/api\/announcements\/([^/]+)\/ack$/);
      if (m && request.method === "POST") {
        const response = await handleAckAnnouncement(request, env, ctx, m[1]);
        return withCors(response, request);
      }
    }

    if (path.startsWith("/api/auth")) {
      try {
        const response = await auth(env).handler(request);
        return withCors(response, request);
      } catch (e) {
        console.error(
          "[Worker] Auth error:",
          e instanceof Error ? e.message : "unknown",
        );
        return withCors(
          jsonResponse({ error: "Authentication error" }, 500),
          request,
        );
      }
    }

    return withCors(jsonResponse({ error: "Not found" }, 404), request);
  },
};
