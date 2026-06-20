"use client";

import { ErrorBoundary, type FallbackProps } from "react-error-boundary";

function Fallback({ error, resetErrorBoundary }: FallbackProps) {
  const msg = error instanceof Error ? error.message : String(error);
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3 px-6 text-white app-page-bg">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-red-500/10 border border-red-500/20">
        <span className="text-2xl" aria-hidden>
          ⚠️
        </span>
      </div>
      <h1 className="text-xl font-semibold tracking-tight">
        Something went wrong
      </h1>
      <p className="max-w-md text-center text-sm text-[color:var(--app-muted)]">
        {msg}
      </p>
      <div className="flex gap-3">
        <button
          type="button"
          className="rounded-md bg-emerald-500/20 px-3 py-1.5 text-sm text-emerald-200 hover:bg-emerald-500/30 border border-emerald-500/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--app-ring)]"
          onClick={resetErrorBoundary}
        >
          Try again
        </button>
        <button
          type="button"
          className="rounded-md bg-[color:color-mix(in_oklch,var(--app-surface-elev)_85%,transparent)] border border-[color:var(--app-border)] px-3 py-1.5 text-sm text-[color:var(--app-text)] hover:bg-[color:color-mix(in_oklch,var(--app-surface-elev)_95%,transparent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--app-ring)]"
          onClick={() => window.location.reload()}
        >
          Reload app
        </button>
      </div>
    </div>
  );
}

export default function AppErrorBoundary({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <ErrorBoundary
      FallbackComponent={Fallback}
      onError={(err) => {
        // Keep log minimal; full stack would be captured by observability.
        const msg = err instanceof Error ? err.message : String(err);
        console.error("[App] unhandled render error:", msg);
      }}
    >
      {children}
    </ErrorBoundary>
  );
}
