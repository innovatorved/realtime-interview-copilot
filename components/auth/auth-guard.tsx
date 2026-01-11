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
        // This ensures all events are associated with the user, even across sessions
        if (session.user) {
          posthog.identify(session.user.id, {
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

  // Check if user is approved
  // @ts-ignore - isApproved is added to schema but types might not be inferred yet in client
  if (session?.user && !session.user.isApproved) {
    return <WaitingForApproval email={session.user.email} />;
  }

  return <>{children}</>;
}
