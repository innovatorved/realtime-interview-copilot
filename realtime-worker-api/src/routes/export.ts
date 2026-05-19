/** /api/export — markdown / printable-HTML export of saved notes. */

import { and, desc, eq, sql } from "drizzle-orm";
import { getDb } from "../db";
import { savedNote } from "../db/schema";
import {
  authErrorResponse,
  getAuthenticatedUser,
  isAuthed,
} from "../middleware/auth";
import { escapeHtml } from "../lib/html";
import { jsonResponse } from "../lib/http";
import { renderMarkdownToHtml } from "../lib/markdown-to-html";
import { recordUsage } from "../usage";
import type { Env } from "../env";

const MAX_NOTE_IDS_PER_EXPORT = 500;

interface ExportRequestBody {
  format: "markdown" | "pdf";
  noteIds?: string[];
}

export async function handleExport(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  const auth = await getAuthenticatedUser(request, env, ctx);
  if (!isAuthed(auth)) return authErrorResponse(auth.error);
  const user = auth;

  let body: ExportRequestBody;
  try {
    body = (await request.json()) as ExportRequestBody;
  } catch {
    return jsonResponse({ error: "Invalid JSON" }, 400);
  }

  const format = body.format;
  if (format !== "markdown" && format !== "pdf") {
    return jsonResponse({ error: "format must be 'markdown' or 'pdf'" }, 400);
  }

  if (body.noteIds !== undefined) {
    if (!Array.isArray(body.noteIds)) {
      return jsonResponse({ error: "noteIds must be an array" }, 400);
    }
    if (body.noteIds.length > MAX_NOTE_IDS_PER_EXPORT) {
      return jsonResponse(
        { error: `noteIds must be <= ${MAX_NOTE_IDS_PER_EXPORT}` },
        400,
      );
    }
    for (const id of body.noteIds) {
      if (typeof id !== "string" || !/^[a-zA-Z0-9_-]{1,128}$/.test(id)) {
        return jsonResponse({ error: "noteIds contains an invalid id" }, 400);
      }
    }
  }

  const db = getDb(env);

  let notes;
  if (body.noteIds && body.noteIds.length > 0) {
    notes = await db
      .select()
      .from(savedNote)
      .where(
        and(
          eq(savedNote.userId, user.id),
          sql`${savedNote.id} IN (${sql.join(
            body.noteIds.map((id) => sql`${id}`),
            sql`, `,
          )})`,
        ),
      )
      .orderBy(desc(savedNote.createdAt));
  } else {
    notes = await db
      .select()
      .from(savedNote)
      .where(eq(savedNote.userId, user.id))
      .orderBy(desc(savedNote.createdAt));
  }

  if (notes.length === 0) {
    recordUsage(env, ctx, request, user, `export_${format}`, {
      status: "error",
      errorCode: "no_notes",
    });
    return jsonResponse({ error: "No notes found to export" }, 404);
  }

  const markdown = buildExportMarkdown(notes, user.name);

  recordUsage(env, ctx, request, user, `export_${format}`, {
    responseChars: markdown.length,
    metadata: { noteCount: notes.length },
  });

  if (format === "markdown") {
    return new Response(markdown, {
      headers: {
        "Content-Type": "text/markdown; charset=utf-8",
        "Content-Disposition": `attachment; filename="interview-notes-${new Date().toISOString().split("T")[0]}.md"`,
      },
    });
  }

  const html = buildExportHTML(markdown, user.name);
  return new Response(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
    },
  });
}

function buildExportMarkdown(
  notes: Array<{
    id: string;
    content: string;
    tag: string;
    createdAt: Date;
  }>,
  userName: string,
): string {
  const lines: string[] = [
    `# Interview Notes — ${userName}`,
    `_Exported on ${new Date().toLocaleDateString("en-US", { dateStyle: "long" })}_`,
    "",
    "---",
    "",
  ];

  for (const note of notes) {
    const date = new Date(note.createdAt).toLocaleString("en-US", {
      dateStyle: "medium",
      timeStyle: "short",
    });
    lines.push(`## ${note.tag} · ${note.id.slice(0, 8)}`);
    lines.push(`**${note.tag}** · ${date}`);
    lines.push("");
    lines.push(note.content);
    lines.push("");
    lines.push("---");
    lines.push("");
  }

  return lines.join("\n");
}

function buildExportHTML(markdown: string, userName: string): string {
  // Render markdown server-side so the PDF prints formatted output
  // (headings, lists, bold, etc.) instead of raw `## My note`. The
  // renderer escapes input first, so user content can't inject HTML.
  const renderedBody = renderMarkdownToHtml(markdown);
  const escapedName = escapeHtml(userName ?? "");

  // Tight CSP so the generated file cannot load remote resources. We allow
  // `'unsafe-inline'` on script-src only for the one print() invocation, but
  // connect/img/etc stay `'none'` so no data can be exfiltrated if any
  // injection slipped through.
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src 'none'; connect-src 'none'; font-src 'none';">
  <title>Interview Notes — ${escapedName}</title>
  <style>
    body { font-family: 'Inter', -apple-system, sans-serif; max-width: 800px; margin: 2rem auto; padding: 0 1rem; color: #1a1a1a; line-height: 1.7; }
    h1 { font-size: 1.8rem; border-bottom: 2px solid #e5e7eb; padding-bottom: 0.5rem; }
    h2 { font-size: 1.3rem; margin-top: 2rem; color: #374151; }
    h3 { font-size: 1.1rem; margin-top: 1.4rem; color: #374151; }
    hr { border: none; border-top: 1px solid #e5e7eb; margin: 1.5rem 0; }
    p { margin: 0.6rem 0; }
    ul, ol { padding-left: 1.4rem; margin: 0.6rem 0; }
    li { margin: 0.2rem 0; }
    blockquote { border-left: 3px solid #d1d5db; margin: 0.6rem 0; padding: 0.2rem 0.8rem; color: #4b5563; }
    code { background: #f3f4f6; padding: 0.1rem 0.3rem; border-radius: 4px; font-family: ui-monospace, SFMono-Regular, monospace; font-size: 0.9em; }
    pre { background: #f3f4f6; padding: 0.8rem 1rem; border-radius: 6px; overflow-x: auto; }
    pre code { background: transparent; padding: 0; }
    a { color: #1d4ed8; text-decoration: underline; }
    @media print { body { margin: 0; } a { color: inherit; text-decoration: none; } }
  </style>
</head>
<body>
  ${renderedBody}
  <script>window.onload = function() { window.print(); }</script>
</body>
</html>`;
}
