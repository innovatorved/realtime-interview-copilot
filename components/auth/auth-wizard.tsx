"use client";

import { LogoMark } from "@/components/brand/v-logo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Modal } from "@/components/ui/modal";
import { authClient, setStoredSessionToken } from "@/lib/auth-client";
import { APP_DISPLAY_NAME, BACKEND_API_URL } from "@/lib/constant";
import { authTokens as TOKEN } from "@/lib/design-tokens";
import { RIC_CLIENT_HEADER } from "@/lib/ric-fetch";
import { cn } from "@/lib/utils";
import { ExternalLink, KeyRound, Loader2, ShieldCheck } from "lucide-react";
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
      className="hero-grid-bg min-h-screen w-full flex flex-col items-center justify-center px-4 py-10"
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
            fontSize: 13.5,
            lineHeight: 1.55,
          }}
        >
          {modalMessage}
        </p>
        <div className="mt-5 flex justify-end">
          <Button type="button" size="sm" onClick={() => setModalOpen(false)}>
            OK
          </Button>
        </div>
      </Modal>

      <div className="mb-5 flex flex-col items-center text-center">
        <div className="flex items-center gap-2.5">
          <LogoMark size="md" />
          <div className="text-left">
            <span className="block text-[14px] font-bold tracking-[-0.02em] text-ink leading-tight">
              {APP_DISPLAY_NAME}
            </span>
            <span className="block font-mono text-[10px] uppercase tracking-[0.06em] text-mute">
              sso.vedgupta.in · Identity
            </span>
          </div>
        </div>
      </div>

      <div
        className="w-full max-w-[400px] rounded-xl border border-hairline-strong bg-surface p-6"
        style={{
          boxShadow:
            "0 1px 0 rgba(255,255,255,0.04) inset, 0 24px 48px -12px rgba(0, 0, 0, 0.8)",
        }}
      >
        <div className="mb-5 space-y-1.5">
          <div className="mb-2 flex items-center gap-2">
            <span className="eco-pill eco-pill--green">
              <span className="h-1.5 w-1.5 rounded-full bg-accent-green" />
              OAuth 2.1 + PKCE
            </span>
          </div>
          <h1 className="text-[19px] font-bold tracking-[-0.025em] text-ink leading-tight">
            Sign in with VedGupta SSO
          </h1>
          <p className="text-[13px] text-mute leading-relaxed">
            Authentication and account approval are managed centrally through{" "}
            <span className="font-mono text-[12px] text-body">
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
            <ExternalLink className="h-3.5 w-3.5 opacity-70" />
          </NotionPrimaryButton>

          {awaitingBrowser && !loading && (
            <div className="rounded-lg border border-hairline bg-surface-elevated px-3 py-2.5 text-[12px] leading-relaxed text-mute">
              Complete sign-in in your browser window. Once approved,
              you&apos;ll be redirected back to {APP_DISPLAY_NAME}{" "}
              automatically.
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
              className="inline-flex items-center gap-1.5 text-[11.5px] text-mute transition-colors hover:text-ink"
            >
              <KeyRound className="h-3 w-3" />
              {showManualTicket
                ? "Hide manual sign-in code"
                : "Browser didn't redirect back? Enter sign-in code"}
            </button>

            {showManualTicket && (
              <div className="mt-2.5 grid gap-2 rounded-lg border border-hairline bg-surface-elevated p-3">
                <Label
                  htmlFor="sso-ticket"
                  className="font-mono text-[10px] uppercase tracking-[0.06em] text-mute"
                >
                  One-time sign-in code from browser
                </Label>
                <div className="flex gap-2">
                  <Input
                    id="sso-ticket"
                    placeholder="Paste code here…"
                    value={manualTicket}
                    onChange={(e) => setManualTicket(e.target.value)}
                    className="h-9 bg-surface text-[12px] font-mono"
                  />
                  <Button
                    type="button"
                    disabled={!manualTicket.trim() || loading}
                    onClick={() => void exchangeTicket(manualTicket)}
                    className="h-9 px-3.5 text-[12px] font-semibold shrink-0"
                  >
                    Verify
                  </Button>
                </div>
              </div>
            )}
          </div>

          <div className="mt-1.5 flex items-start gap-2.5 rounded-lg border border-hairline bg-surface-elevated px-3 py-2.5">
            <span className="mt-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded border border-accent-green/30 bg-accent-green/10 font-mono text-[10px] font-bold text-accent-green">
              i
            </span>
            <p className="m-0 text-[11.5px] leading-relaxed text-mute">
              Existing accounts were migrated to{" "}
              <strong className="font-medium text-body">sso.vedgupta.in</strong>
              . On your first login, reset your password if prompted.
            </p>
          </div>
        </div>

        <div className="mt-5 border-t border-hairline pt-3.5 text-center">
          <p className="m-0 font-mono text-[10px] leading-relaxed text-stone">
            Protected by OAuth 2.1 + PKCE · Intended for educational use
          </p>
        </div>
      </div>
    </div>
  );
}
