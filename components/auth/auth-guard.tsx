"use client";

import { authClient } from "@/lib/auth-client";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { AuthWizard } from "./auth-wizard";
import { WaitingForApproval } from "./waiting-for-approval";

export function AuthGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { data: session, isPending, error } = authClient.useSession();
  const [authenticated, setAuthenticated] = useState(false);

  useEffect(() => {
    if (!isPending) {
      if (session) {
        setAuthenticated(true);
      } else {
        setAuthenticated(false);
      }
    }
  }, [session, isPending]);

  useEffect(() => {
    const handleLogout = () => {
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
