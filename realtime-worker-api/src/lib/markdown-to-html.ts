/** Tiny, deliberately conservative markdown → HTML renderer for the PDF
 *  export. We do NOT pull in a dependency because:
 *    - the worker bundle stays small,
 *    - we control exactly which constructs are emitted, and
 *    - the only inputs are notes the candidate has written, which we
 *      already cap at 50K chars.
 *
 *  Every dynamic value is HTML-escaped first, then a small set of inline
 *  constructs (bold, italic, code, links, headings, lists, hr) is replaced
 *  by escaped HTML tokens. Image syntax is intentionally dropped — the
 *  export CSP forbids img-src so they wouldn't render anyway and we don't
 *  want any URL fetch attempts. */

import { escapeHtml } from "./html";

export function renderMarkdownToHtml(md: string): string {
  const escaped = escapeHtml(md);
  const lines = escaped.split(/\r?\n/);
  const out: string[] = [];

  let inCodeBlock = false;
  let listType: "ul" | "ol" | null = null;

  const closeList = () => {
    if (listType) {
      out.push(`</${listType}>`);
      listType = null;
    }
  };

  const renderInline = (s: string): string => {
    // Order matters: code spans first (so we don't process markdown
    // inside them), then links, then bold, then italic.
    return s
      .replace(/`([^`]+)`/g, "<code>$1</code>")
      .replace(
        /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
        '<a href="$1" rel="noopener noreferrer nofollow">$2</a>',
      )
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/__([^_]+)__/g, "<strong>$1</strong>")
      .replace(/(^|[\s(])\*([^*\n]+)\*/g, "$1<em>$2</em>")
      .replace(/(^|[\s(])_([^_\n]+)_/g, "$1<em>$2</em>");
  };

  for (const raw of lines) {
    const line = raw;

    if (/^\s*```/.test(line)) {
      closeList();
      if (inCodeBlock) {
        out.push("</code></pre>");
        inCodeBlock = false;
      } else {
        out.push("<pre><code>");
        inCodeBlock = true;
      }
      continue;
    }

    if (inCodeBlock) {
      out.push(line);
      continue;
    }

    if (/^\s*$/.test(line)) {
      closeList();
      continue;
    }

    if (
      /^---+\s*$/.test(line) ||
      /^___+\s*$/.test(line) ||
      /^\*\*\*+\s*$/.test(line)
    ) {
      closeList();
      out.push("<hr />");
      continue;
    }

    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      closeList();
      const level = heading[1].length;
      out.push(`<h${level}>${renderInline(heading[2])}</h${level}>`);
      continue;
    }

    const ul = /^\s*[-*+]\s+(.*)$/.exec(line);
    if (ul) {
      if (listType !== "ul") {
        closeList();
        out.push("<ul>");
        listType = "ul";
      }
      out.push(`<li>${renderInline(ul[1])}</li>`);
      continue;
    }

    const ol = /^\s*\d+\.\s+(.*)$/.exec(line);
    if (ol) {
      if (listType !== "ol") {
        closeList();
        out.push("<ol>");
        listType = "ol";
      }
      out.push(`<li>${renderInline(ol[1])}</li>`);
      continue;
    }

    const blockquote = /^&gt;\s+(.*)$/.exec(line); // already escaped
    if (blockquote) {
      closeList();
      out.push(`<blockquote>${renderInline(blockquote[1])}</blockquote>`);
      continue;
    }

    closeList();
    out.push(`<p>${renderInline(line)}</p>`);
  }

  closeList();
  if (inCodeBlock) out.push("</code></pre>");

  return out.join("\n");
}
