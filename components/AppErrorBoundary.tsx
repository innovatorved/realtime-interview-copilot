"use client";

import { ErrorBoundary, type FallbackProps } from "react-error-boundary";

function Fallback({ error, resetErrorBoundary }: FallbackProps) {
  const msg = error instanceof Error ? error.message : String(error);
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3 px-6 text-white">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-red-500/10">
        <span className="text-2xl">⚠️</span>
      </div>
      <h1 className="text-xl font-semibold">Something went wrong</h1>
      <p className="max-w-md text-center text-sm text-zinc-400">{msg}</p>
      <div className="flex gap-3">
        <button
          type="button"
          className="rounded-md bg-emerald-500/20 px-3 py-1.5 text-sm text-emerald-200 hover:bg-emerald-500/30"
          onClick={resetErrorBoundary}
        >
          Try again
        </button>
        <button
          type="button"
          className="rounded-md bg-zinc-800 px-3 py-1.5 text-sm text-zinc-200 hover:bg-zinc-700"
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
