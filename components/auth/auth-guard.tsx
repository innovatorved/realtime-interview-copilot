"use client";

import { authClient } from "@/lib/auth-client";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { AuthWizard } from "./auth-wizard";
import { WaitingForApproval } from "./waiting-for-approval";
import posthog from "posthog-js";

export function AuthGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { data: session, isPending, error } = authClient.useSession();
  const [authenticated, setAuthenticated] = useState(false);
  // Mark the router as used so stricter lint rules don't drop it; we keep it
  // for future redirects triggered from this component.
  void router;

  useEffect(() => {
    if (isPending) return;
    setAuthenticated(Boolean(session));
  }, [session, isPending]);

  useEffect(() => {
    const handleLogout = () => {
      // Capture logout event and reset PostHog before clearing authentication
      // Pass true to also reset device_id so the device is considered new
      posthog.capture("user_logged_out");
      posthog.reset(true);
      setAuthenticated(false);
    };

    window.addEventListener("auth:logout", handleLogout);
    return () => {
      window.removeEventListener("auth:logout", handleLogout);
    };
  }, []);

  if (isPending) {
    return (
      <div className="flex items-center justify-center min-h-screen text-white">
        Loading...
      </div>
    );
  }

  if (error) {
    // Surface session errors instead of getting stuck on Loading…, and give
    // the user a way to retry and to fall back to the sign-in flow.
    const msg = error instanceof Error ? error.message : String(error);
    return (
      <div className="flex flex-col items-center justify-center min-h-screen text-white gap-3 px-6">
        <div className="w-12 h-12 rounded-full bg-red-500/10 flex items-center justify-center">
          <span className="text-2xl">⚠️</span>
        </div>
        <h1 className="text-xl font-semibold">Could not verify your session</h1>
        <p className="text-sm text-zinc-400 text-center max-w-md">{msg}</p>
        <div className="flex gap-3">
          <button
            type="button"
            className="text-sm px-3 py-1.5 rounded-md bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-200"
            onClick={() => window.location.reload()}
          >
            Retry
          </button>
          <button
            type="button"
            className="text-sm px-3 py-1.5 rounded-md bg-zinc-800 hover:bg-zinc-700 text-zinc-200"
            onClick={() => setAuthenticated(false)}
          >
            Sign in again
          </button>
        </div>
      </div>
    );
  }

  if (!authenticated) {
    return <AuthWizard onSuccess={() => setAuthenticated(true)} />;
  }

  // Better Auth's generated user type doesn't include our custom
  // approval/ban columns. Narrow through a local interface instead of
  // @ts-ignore so TS still catches misspellings.
  const extendedUser = session?.user as
    | { email: string; isBanned?: boolean; isApproved?: boolean }
    | undefined;
  if (extendedUser?.isBanned) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen text-white gap-4 px-6">
        <div className="w-12 h-12 rounded-full bg-red-500/10 flex items-center justify-center">
          <span className="text-2xl">🚫</span>
        </div>
        <h1 className="text-xl font-semibold">Account suspended</h1>
        <p className="text-sm text-zinc-400 text-center max-w-md">
          Your account has been suspended. Contact the administrator if you
          believe this is an error.
        </p>
        <button
          className="text-sm text-zinc-500 hover:text-white mt-2"
          onClick={() => {
            void authClient.signOut();
            window.dispatchEvent(new Event("auth:logout"));
          }}
        >
          Sign out
        </button>
      </div>
    );
  }

  if (extendedUser && !extendedUser.isApproved) {
    return <WaitingForApproval email={extendedUser.email} />;
  }

  return <>{children}</>;
}
