"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Modal } from "@/components/ui/modal";
import { authClient, setStoredSessionToken } from "@/lib/auth-client";
import { APP_DISPLAY_NAME, BACKEND_API_URL } from "@/lib/constant";
import { authTokens as TOKEN } from "@/lib/design-tokens";
import { RIC_CLIENT_HEADER } from "@/lib/ric-fetch";
import { cn } from "@/lib/utils";
import { ExternalLink, KeyRound, Loader2, Mic, ShieldCheck } from "lucide-react";
import { useRouter } from "next/navigation";
import posthog from "posthog-js";
import { useCallback, useEffect, useRef, useState } from "react";

interface AuthWizardProps {
  initialStep?: "welcome" | "signup" | "signin";
  onSuccess?: () => void;
}

function NotionPrimaryButton({
  children,
  loading,
  disabled,
  className,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { loading?: boolean }) {
  return (
    <Button
      {...rest}
      disabled={disabled || loading}
      className={cn("h-9 w-full gap-2 text-[13px] font-semibold", className)}
    >
      {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
      {children}
    </Button>
  );
}

function NotionSecondaryButton({
  children,
  className,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <Button
      {...rest}
      variant="secondary"
      className={cn("h-9 w-full text-[13px] font-medium", className)}
    >
      {children}
    </Button>
  );
}

async function openUrlInSystemBrowser(url: string): Promise<void> {
  if (typeof window !== "undefined" && window.electronAPI?.openExternal) {
    const ok = await window.electronAPI.openExternal(url);
    if (ok) return;
  }
  window.open(url, "_blank", "noopener,noreferrer");
}

export function AuthWizard({ onSuccess }: AuthWizardProps) {
  const [loading, setLoading] = useState(false);
  const [awaitingBrowser, setAwaitingBrowser] = useState(false);
  const [showManualTicket, setShowManualTicket] = useState(false);
  const [manualTicket, setManualTicket] = useState("");
  const exchangingRef = useRef(false);

  const [modalOpen, setModalOpen] = useState(false);
  const [modalTitle, setModalTitle] = useState("");
  const [modalMessage, setModalMessage] = useState("");
  const [modalTone, setModalTone] = useState<"info" | "error" | "success">(
    "info",
  );

  const router = useRouter();

  const showModal = useCallback(
    (
      title: string,
      message: string,
      tone: "info" | "error" | "success" = "info",
    ) => {
      setModalTitle(title);
      setModalMessage(message);
      setModalTone(tone);
      setModalOpen(true);
    },
    [],
  );

  const handleSuccess = useCallback(() => {
    if (onSuccess) {
      onSuccess();
    } else {
      router.push("/");
    }
  }, [onSuccess, router]);

  const exchangeTicket = useCallback(
    async (rawTicket: string) => {
      const cleaned = rawTicket.trim();
      if (!cleaned || exchangingRef.current) return;
      exchangingRef.current = true;
      setLoading(true);
      try {
        const res = await fetch(`${BACKEND_API_URL}/api/sso/desktop/exchange`, {
          method: "POST",
          credentials: "include",
          headers: {
            "Content-Type": "application/json",
            "X-Requested-With": RIC_CLIENT_HEADER,
          },
          body: JSON.stringify({ ticket: cleaned }),
        });
        const data = (await res.json().catch(() => null)) as {
          ok?: boolean;
          token?: string;
          userId?: string;
          error?: { message?: string } | string;
        } | null;

        if (!res.ok || !data?.token) {
          const errMsg =
            (typeof data?.error === "object"
              ? data.error?.message
              : data?.error) ||
            "Could not complete VedGupta SSO sign-in. Please try again.";
          posthog.capture("sso_signin_error", { error_message: errMsg });
          showModal("Sign in failed", errMsg, "error");
          setLoading(false);
          setAwaitingBrowser(false);
          exchangingRef.current = false;
          return;
        }

        setStoredSessionToken(data.token);
        const sessionRes = await authClient.getSession();
        const userEmail = sessionRes?.data?.user?.email;
        if (userEmail) {
          posthog.identify(userEmail, { email: userEmail });
        }
        posthog.capture("user_signed_in", {
          method: "vedgupta_sso",
          email: userEmail,
        });
        setAwaitingBrowser(false);
        setLoading(false);
        exchangingRef.current = false;
        handleSuccess();
      } catch (e: unknown) {
        const msg =
          e instanceof Error ? e.message : "An unexpected error occurred";
        showModal("Something went wrong", msg, "error");
        setLoading(false);
        setAwaitingBrowser(false);
        exchangingRef.current = false;
      }
    },
    [handleSuccess, showModal],
  );

  useEffect(() => {
    if (typeof window === "undefined" || !window.electronAPI?.onAuthCallback) {
      return;
    }
    return window.electronAPI.onAuthCallback((payload) => {
      if (payload.error) {
        setAwaitingBrowser(false);
        setLoading(false);
        showModal(
          "SSO Authentication Failed",
          payload.error === "access_denied"
            ? "Access was denied or your account is awaiting approval on sso.vedgupta.in."
            : `Authentication failed (${payload.error}).`,
          "error",
        );
        return;
      }
      if (payload.ticket) {
        void exchangeTicket(payload.ticket);
      }
    });
  }, [exchangeTicket, showModal]);

  const handleStartSso = async () => {
    setAwaitingBrowser(true);
    const startUrl = `${BACKEND_API_URL}/api/sso/desktop/start`;
    await openUrlInSystemBrowser(startUrl);
  };

  return (
    <div
      className="min-h-screen w-full flex items-center justify-center px-4 py-10"
      style={{ backgroundColor: TOKEN.pageBg }}
    >
      <Modal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        title={modalTitle}
      >
        <p
          style={{
            color:
              modalTone === "error"
                ? TOKEN.semanticError
                : modalTone === "success"
                  ? TOKEN.semanticSuccess
                  : TOKEN.charcoal,
            margin: 0,
            fontSize: 14,
            lineHeight: 1.55,
          }}
        >
          {modalMessage}
        </p>
        <div className="mt-5 flex justify-end">
          <button
            type="button"
            onClick={() => setModalOpen(false)}
            style={{
              backgroundColor: TOKEN.accent,
              color: "#0a0a0a",
              border: "none",
              padding: "8px 16px",
              borderRadius: 8,
              fontSize: 13,
              fontWeight: 600,
              cursor: "pointer",
              boxShadow: `0 0 0 1px ${TOKEN.accentBorder}, 0 0 16px ${TOKEN.accentRing}`,
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = TOKEN.accentHover;
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = TOKEN.accent;
            }}
          >
            OK
          </button>
        </div>
      </Modal>

      <div
        className="w-full max-w-sm"
        style={{
          backgroundColor: TOKEN.cardBg,
          backdropFilter: "blur(24px)",
          WebkitBackdropFilter: "blur(24px)",
          border: `1px solid ${TOKEN.cardBorder}`,
          borderRadius: 12,
          padding: 22,
          boxShadow:
            "0 4px 12px rgba(0,0,0,0.4), 0 24px 48px -16px rgba(0,0,0,0.5)",
        }}
      >
        <div className="flex items-center gap-2 mb-5">
          <div
            className="flex h-7 w-7 items-center justify-center"
            style={{
              background: "linear-gradient(135deg, #34d399, #10b981, #059669)",
              color: "#0a0a0a",
              borderRadius: 7,
              boxShadow: `0 0 12px ${TOKEN.accentRing}`,
            }}
          >
            <Mic className="h-3.5 w-3.5" />
          </div>
          <div>
            <p
              style={{
                color: TOKEN.ink,
                fontSize: 12.5,
                fontWeight: 600,
                letterSpacing: "-0.1px",
                lineHeight: 1.2,
                margin: 0,
              }}
            >
              {APP_DISPLAY_NAME}
            </p>
            <p
              style={{
                color: TOKEN.steel,
                fontSize: 10.5,
                lineHeight: 1.3,
                margin: 0,
              }}
            >
              Your real-time interview workspace
            </p>
          </div>
        </div>

        <div className="mb-4">
          <h1
            style={{
              color: TOKEN.ink,
              fontSize: 18,
              fontWeight: 600,
              lineHeight: 1.25,
              letterSpacing: "-0.3px",
              margin: 0,
            }}
          >
            Sign in with VedGupta SSO
          </h1>
          <p
            style={{
              color: TOKEN.slate,
              fontSize: 12.5,
              lineHeight: 1.5,
              marginTop: 4,
              marginBottom: 0,
            }}
          >
            Authentication and account approval are managed centrally through{" "}
            <span style={{ color: TOKEN.charcoal, fontWeight: 500 }}>
              sso.vedgupta.in
            </span>
            .
          </p>
        </div>

        <div className="grid gap-2.5">
          <NotionPrimaryButton
            onClick={() => void handleStartSso()}
            loading={loading}
          >
            <ShieldCheck className="h-4 w-4" />
            {loading
              ? "Completing sign-in…"
              : awaitingBrowser
                ? "Re-open VedGupta SSO in browser"
                : "Continue with VedGupta SSO"}
            <ExternalLink className="h-3.5 w-3.5 opacity-80" />
          </NotionPrimaryButton>

          {awaitingBrowser && !loading && (
            <div
              className="rounded-md px-3 py-2 text-xs"
              style={{
                backgroundColor: "rgba(255,255,255,0.04)",
                border: `1px solid ${TOKEN.hairlineStrong}`,
                color: TOKEN.slate,
                lineHeight: 1.5,
              }}
            >
              Complete sign-in in your browser window. Once approved, you&apos;ll
              be redirected back to {APP_DISPLAY_NAME} automatically.
            </div>
          )}

          <NotionSecondaryButton
            onClick={() =>
              void openUrlInSystemBrowser(
                "https://sso.vedgupta.in/forgot-password?reason=migrated",
              )
            }
          >
            Reset migrated account password
          </NotionSecondaryButton>

          <div className="mt-1">
            <button
              type="button"
              onClick={() => setShowManualTicket((v) => !v)}
              className="inline-flex items-center gap-1.5 text-xs"
              style={{
                color: TOKEN.steel,
                background: "none",
                border: "none",
                padding: 0,
                cursor: "pointer",
              }}
            >
              <KeyRound className="h-3 w-3" />
              {showManualTicket
                ? "Hide manual sign-in code"
                : "Browser didn't redirect back? Enter sign-in code"}
            </button>

            {showManualTicket && (
              <div className="mt-2 grid gap-2">
                <Label htmlFor="sso-ticket" className="text-xs">
                  One-time sign-in code from browser
                </Label>
                <div className="flex gap-2">
                  <Input
                    id="sso-ticket"
                    placeholder="Paste code here…"
                    value={manualTicket}
                    onChange={(e) => setManualTicket(e.target.value)}
                    className="h-9 text-[12.5px] font-mono"
                  />
                  <Button
                    type="button"
                    disabled={!manualTicket.trim() || loading}
                    onClick={() => void exchangeTicket(manualTicket)}
                    className="h-9 px-3 text-[12.5px] font-semibold shrink-0"
                  >
                    Verify
                  </Button>
                </div>
              </div>
            )}
          </div>

          <div
            className="mt-2 flex items-start gap-2 rounded-md px-2.5 py-2"
            style={{
              backgroundColor: TOKEN.accentSoft,
              border: `1px solid ${TOKEN.accentBorder}`,
            }}
          >
            <span
              className="mt-0.5 inline-flex items-center justify-center rounded shrink-0"
              style={{
                backgroundColor: TOKEN.accent,
                color: "#ffffff",
                width: 14,
                height: 14,
                fontSize: 9,
                fontWeight: 700,
              }}
            >
              i
            </span>
            <p
              style={{
                margin: 0,
                color: TOKEN.accentText,
                fontSize: 11,
                lineHeight: 1.5,
              }}
            >
              Existing accounts were migrated to{" "}
              <strong>sso.vedgupta.in</strong>. On your first login, reset your
              password and request approval from the SSO portal.
            </p>
          </div>
        </div>

        <div
          className="mt-5 pt-4 text-center"
          style={{ borderTop: `1px solid ${TOKEN.hairline}` }}
        >
          <p
            style={{
              color: TOKEN.stone,
              fontSize: 10,
              lineHeight: 1.4,
              margin: 0,
            }}
          >
            By continuing, you agree to our terms and acknowledge that this tool
            is intended for educational use.
          </p>
        </div>
      </div>
    </div>
  );
}
