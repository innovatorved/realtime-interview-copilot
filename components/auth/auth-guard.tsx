"use client";

import { authClient } from "@/lib/auth-client";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { AuthWizard } from "./auth-wizard";

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

  return <>{children}</>;
}
