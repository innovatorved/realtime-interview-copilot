"use client";

import ReactMarkdown, { type Options } from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";

// Tightened schema: disallow raw HTML, images (we don't need them in AI
// responses), and scheme-unsafe URLs. Keeps the common GFM output.
const schema = {
  ...defaultSchema,
  tagNames: (defaultSchema.tagNames ?? []).filter((t) => t !== "img"),
  protocols: {
    ...defaultSchema.protocols,
    href: ["http", "https", "mailto"],
    src: ["http", "https"],
  },
};

function safeUrlTransform(url: string): string {
  const trimmed = (url ?? "").trim();
  if (!trimmed) return "";
  const lower = trimmed.toLowerCase();
  if (
    lower.startsWith("javascript:") ||
    lower.startsWith("vbscript:") ||
    (lower.startsWith("data:") && !lower.startsWith("data:image/"))
  ) {
    return "";
  }
  return trimmed;
}

type SafeMarkdownProps = Omit<Options, "remarkPlugins" | "rehypePlugins" | "urlTransform"> & {
  children: string;
};

export default function SafeMarkdown(props: SafeMarkdownProps) {
  return (
    <ReactMarkdown
      {...props}
      remarkPlugins={[remarkGfm]}
      rehypePlugins={[[rehypeSanitize, schema]]}
      urlTransform={safeUrlTransform}
    />
  );
}
