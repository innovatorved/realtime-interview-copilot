"use client";

import { ArrowRight, KeyRound, Loader2, ShieldCheck } from "lucide-react";
import { useRouter } from "next/navigation";
import posthog from "posthog-js";
import { useCallback, useEffect, useRef, useState } from "react";
import { LogoMark } from "@/components/brand/v-logo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { authClient, setStoredSessionToken } from "@/lib/auth-client";
import { APP_DISPLAY_NAME, BACKEND_API_URL } from "@/lib/constant";
import { authTokens as TOKEN } from "@/lib/design-tokens";
import { RIC_CLIENT_HEADER } from "@/lib/ric-fetch";

interface AuthWizardProps {
  initialStep?: "welcome" | "signup" | "signin";
  onSuccess?: () => void;
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

      <div
        className="w-full max-w-[380px] rounded-xl p-6"
        style={{
          backgroundColor: TOKEN.cardBg,
          backdropFilter: "blur(24px)",
          WebkitBackdropFilter: "blur(24px)",
          border: `1px solid ${TOKEN.cardBorder}`,
          boxShadow:
            "0 4px 12px rgba(0,0,0,0.35), 0 24px 48px -16px rgba(0,0,0,0.45)",
        }}
      >
        <div className="mb-6">
          <div className="flex items-center justify-between mb-4">
            <LogoMark size="sm" />
            <span className="eco-pill eco-pill--green">
              <span className="w-1.5 h-1.5 rounded-full bg-accent" />
              VEDGUPTA SSO
            </span>
          </div>
          <h1 className="text-[19px] font-semibold text-text-primary tracking-[-0.025em]">
            {APP_DISPLAY_NAME}
          </h1>
          <p className="text-[13px] text-text-secondary mt-1">
            Sign in with your authorized VedGupta SSO account
          </p>
        </div>

        <div className="space-y-3.5">
          <Button
            onClick={() => void handleStartSso()}
            disabled={loading}
            className="w-full h-9 text-xs font-medium gap-2"
          >
            {loading ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <ShieldCheck className="w-3.5 h-3.5" />
            )}
            {loading
              ? "Completing sign-in…"
              : awaitingBrowser
                ? "Re-open VedGupta SSO in browser"
                : "Sign in with VedGupta SSO"}
            {!loading && <ArrowRight className="w-3.5 h-3.5" />}
          </Button>

          {awaitingBrowser && !loading && (
            <div className="rounded-lg border border-border-default bg-surface-inset px-3 py-2 text-[12px] leading-relaxed text-text-secondary">
              Complete sign-in in your browser window. Once approved,
              you&apos;ll be redirected back to {APP_DISPLAY_NAME}{" "}
              automatically.
            </div>
          )}

          <div className="pt-1">
            <button
              type="button"
              onClick={() => setShowManualTicket((v) => !v)}
              className="inline-flex items-center gap-1.5 text-[11px] font-mono text-text-tertiary hover:text-text-primary transition-colors cursor-pointer"
            >
              <KeyRound className="w-3 h-3" />
              {showManualTicket
                ? "Hide sign-in code input"
                : "Use one-time SSO code instead"}
            </button>

            {showManualTicket && (
              <div className="mt-2.5 space-y-2">
                <div className="flex gap-2">
                  <Input
                    id="sso-ticket"
                    type="text"
                    placeholder="Paste SSO code…"
                    value={manualTicket}
                    onChange={(e) => setManualTicket(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") void exchangeTicket(manualTicket);
                    }}
                    className="h-8 text-xs font-mono bg-surface-inset"
                  />
                  <Button
                    type="button"
                    disabled={!manualTicket.trim() || loading}
                    onClick={() => void exchangeTicket(manualTicket)}
                    className="h-8 px-3 text-xs shrink-0"
                  >
                    Verify
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>

        <p className="font-mono text-[10.5px] text-text-tertiary text-center mt-6 pt-4 border-t border-border-subtle">
          Managed centrally via{" "}
          <button
            type="button"
            onClick={() =>
              void openUrlInSystemBrowser("https://sso.vedgupta.in")
            }
            className="underline text-text-secondary hover:text-text-primary cursor-pointer"
          >
            sso.vedgupta.in
          </button>
        </p>
      </div>
    </div>
  );
}
