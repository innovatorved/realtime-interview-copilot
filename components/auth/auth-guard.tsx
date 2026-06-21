"use client";

import { authClient } from "@/lib/auth-client";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { AuthWizard } from "./auth-wizard";
import { WaitingForApproval } from "./waiting-for-approval";
import { AppAnnouncements } from "@/components/announcements/AppAnnouncements";
import { AlertTriangle, Ban, Loader2 } from "lucide-react";
import posthog from "posthog-js";

import { authTokens as TOKEN } from "@/lib/design-tokens";

function AuthLoadingShell() {
  return (
    <div
      className="flex items-center justify-center min-h-screen px-4"
      style={{ backgroundColor: TOKEN.pageBg }}
    >
      <div
        className="flex items-center gap-2.5 px-4 py-2.5 rounded-lg"
        style={{
          backgroundColor: TOKEN.cardBg,
          backdropFilter: "blur(20px)",
          WebkitBackdropFilter: "blur(20px)",
          border: `1px solid ${TOKEN.cardBorder}`,
          color: TOKEN.charcoal,
          fontSize: 14,
          fontWeight: 500,
          boxShadow: "0 4px 12px rgba(0,0,0,0.4)",
        }}
      >
        <Loader2
          className="h-4 w-4 animate-spin"
          style={{ color: TOKEN.accent }}
        />
        Loading workspace…
      </div>
    </div>
  );
}

export function AuthGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { data: session, isPending, error } = authClient.useSession();
  const [mounted, setMounted] = useState(false);
  const [authenticated, setAuthenticated] = useState(false);
  // Mark the router as used so stricter lint rules don't drop it; we keep it
  // for future redirects triggered from this component.
  void router;

  useEffect(() => {
    setMounted(true);
  }, []);

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

  if (!mounted || isPending) {
    return <AuthLoadingShell />;
  }

  const loggedIn = authenticated || Boolean(session);

  if (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return (
      <div
        className="flex items-center justify-center min-h-screen px-4 py-10"
        style={{ backgroundColor: TOKEN.pageBg }}
      >
        <div
          className="w-full max-w-md text-center"
          style={{
            backgroundColor: TOKEN.cardBg,
            backdropFilter: "blur(24px)",
            WebkitBackdropFilter: "blur(24px)",
            border: `1px solid ${TOKEN.cardBorder}`,
            borderRadius: 12,
            padding: 28,
            boxShadow:
              "0 4px 12px rgba(0,0,0,0.4), 0 24px 48px -16px rgba(0,0,0,0.5)",
          }}
        >
          <div
            className="mx-auto mb-4 flex h-11 w-11 items-center justify-center"
            style={{
              backgroundColor: TOKEN.errSoft,
              color: TOKEN.err,
              border: `1px solid ${TOKEN.errBorder}`,
              borderRadius: 10,
            }}
          >
            <AlertTriangle className="h-5 w-5" />
          </div>
          <h1
            style={{
              color: TOKEN.ink,
              fontSize: 20,
              fontWeight: 600,
              letterSpacing: "-0.3px",
              margin: 0,
              lineHeight: 1.25,
            }}
          >
            Couldn&apos;t verify your session
          </h1>
          <p
            style={{
              color: TOKEN.slate,
              fontSize: 14,
              lineHeight: 1.55,
              margin: "8px 0 0",
            }}
          >
            {msg}
          </p>
          <div className="flex justify-center gap-2 mt-5">
            <button
              type="button"
              onClick={() => window.location.reload()}
              style={{
                backgroundColor: TOKEN.accent,
                color: "#0a0a0a",
                border: "none",
                height: 36,
                padding: "0 14px",
                borderRadius: 8,
                fontSize: 13,
                fontWeight: 600,
                cursor: "pointer",
                boxShadow: "0 0 0 1px rgba(16,185,129,0.25)",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.backgroundColor = TOKEN.accentHover;
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = TOKEN.accent;
              }}
            >
              Retry
            </button>
            <button
              type="button"
              onClick={() => setAuthenticated(false)}
              style={{
                backgroundColor: "rgba(255,255,255,0.04)",
                color: TOKEN.ink,
                border: `1px solid ${TOKEN.hairlineStrong}`,
                height: 36,
                padding: "0 14px",
                borderRadius: 8,
                fontSize: 13,
                fontWeight: 500,
                cursor: "pointer",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.backgroundColor =
                  "rgba(255,255,255,0.08)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor =
                  "rgba(255,255,255,0.04)";
              }}
            >
              Sign in again
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!loggedIn) {
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
      <div
        className="flex items-center justify-center min-h-screen px-4 py-10"
        style={{ backgroundColor: TOKEN.pageBg }}
      >
        <div
          className="w-full max-w-md text-center"
          style={{
            backgroundColor: TOKEN.cardBg,
            backdropFilter: "blur(24px)",
            WebkitBackdropFilter: "blur(24px)",
            border: `1px solid ${TOKEN.cardBorder}`,
            borderRadius: 12,
            padding: 28,
            boxShadow:
              "0 4px 12px rgba(0,0,0,0.4), 0 24px 48px -16px rgba(0,0,0,0.5)",
          }}
        >
          <div
            className="mx-auto mb-4 flex h-11 w-11 items-center justify-center"
            style={{
              backgroundColor: TOKEN.errSoft,
              color: TOKEN.err,
              border: `1px solid ${TOKEN.errBorder}`,
              borderRadius: 10,
            }}
          >
            <Ban className="h-5 w-5" />
          </div>
          <h1
            style={{
              color: TOKEN.ink,
              fontSize: 20,
              fontWeight: 600,
              letterSpacing: "-0.3px",
              margin: 0,
              lineHeight: 1.25,
            }}
          >
            Account suspended
          </h1>
          <p
            style={{
              color: TOKEN.slate,
              fontSize: 14,
              lineHeight: 1.55,
              margin: "8px 0 0",
            }}
          >
            Your account has been suspended. Contact the administrator if you
            believe this is an error.
          </p>
          <button
            type="button"
            className="mt-5"
            onClick={() => {
              void authClient.signOut();
              window.dispatchEvent(new Event("auth:logout"));
            }}
            style={{
              backgroundColor: "transparent",
              color: TOKEN.steel,
              border: "none",
              fontSize: 13,
              fontWeight: 500,
              cursor: "pointer",
              textDecoration: "underline",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.color = TOKEN.charcoal;
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.color = TOKEN.steel;
            }}
          >
            Sign out
          </button>
        </div>
      </div>
    );
  }

  if (extendedUser && !extendedUser.isApproved) {
    return <WaitingForApproval email={extendedUser.email} />;
  }

  return (
    <>
      {/*
        Mounted once for every authenticated, approved user. Renders any
        admin-pushed banners and popups. Banners stack at the top of the
        window (below the OS title bar in Electron); popups render as a
        full-screen modal at z-index 120.
      */}
      <div
        className="fixed left-2 right-2 z-[80] pointer-events-none"
        style={{ top: "calc(env(safe-area-inset-top, 0px) + 44px)" }}
      >
        <div className="pointer-events-auto max-w-3xl mx-auto">
          <AppAnnouncements />
        </div>
      </div>
      {children}
    </>
  );
}
