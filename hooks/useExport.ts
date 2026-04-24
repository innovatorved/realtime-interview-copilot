"use client";

import { useState, useCallback } from "react";
import { BACKEND_API_URL } from "@/lib/constant";

export function useExport() {
  const [isExporting, setIsExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const exportNotes = useCallback(
    async (format: "markdown" | "pdf", noteIds?: string[]) => {
      setIsExporting(true);
      setError(null);

      try {
        const res = await fetch(`${BACKEND_API_URL}/api/export`, {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ format, noteIds }),
        });

        if (!res.ok) throw new Error(`HTTP ${res.status}`);

        if (format === "markdown") {
          const text = await res.text();
          const blob = new Blob([text], { type: "text/markdown" });
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          a.download = `interview-notes-${new Date().toISOString().split("T")[0]}.md`;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          URL.revokeObjectURL(url);
        } else {
          // Render the server HTML in a sandboxed iframe served via a blob
          // URL. This isolates the exported document from our origin and
          // cookies; even if the HTML were ever to contain injected script,
          // it cannot touch the app. We trigger print() after load.
          const html = await res.text();
          const blob = new Blob([html], { type: "text/html" });
          const url = URL.createObjectURL(blob);
          const iframe = document.createElement("iframe");
          iframe.setAttribute("sandbox", "allow-same-origin allow-modals");
          iframe.style.position = "fixed";
          iframe.style.right = "0";
          iframe.style.bottom = "0";
          iframe.style.width = "0";
          iframe.style.height = "0";
          iframe.style.border = "0";
          iframe.src = url;
          iframe.onload = () => {
            try {
              iframe.contentWindow?.focus();
              iframe.contentWindow?.print();
            } catch {
              // Print may be blocked; the user can still save the .md export.
            }
            setTimeout(() => {
              URL.revokeObjectURL(url);
              iframe.remove();
            }, 60_000);
          };
          document.body.appendChild(iframe);
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        setError(msg);
      } finally {
        setIsExporting(false);
      }
    },
    [],
  );

  return { isExporting, error, exportNotes };
}
