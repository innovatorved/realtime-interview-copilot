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
          const html = await res.text();
          const printWindow = window.open("", "_blank");
          if (!printWindow) {
            throw new Error("Pop-up blocked. Please allow pop-ups to export as PDF.");
          }
          printWindow.document.write(html);
          printWindow.document.close();
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
