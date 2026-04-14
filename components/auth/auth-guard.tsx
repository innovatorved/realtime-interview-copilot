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

  useEffect(() => {
    if (!isPending) {
      if (session) {
        // Identify user in PostHog when session is available (app load or login)
        // Use email as distinct_id for consistency with backend
        if (session.user) {
          posthog.identify(session.user.email, {
            email: session.user.email,
            name: session.user.name,
          });
        }
        setAuthenticated(true);
      } else {
        setAuthenticated(false);
      }
    }
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

  if (!authenticated) {
    return <AuthWizard onSuccess={() => setAuthenticated(true)} />;
  }

  // @ts-ignore - isBanned is added to schema but types might not be inferred yet in client
  if (session?.user && session.user.isBanned) {
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

  // @ts-ignore - isApproved is added to schema but types might not be inferred yet in client
  if (session?.user && !session.user.isApproved) {
    return <WaitingForApproval email={session.user.email} />;
  }

  return <>{children}</>;
}
