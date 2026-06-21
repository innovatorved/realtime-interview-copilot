"use client";

import { useState } from "react";
import { authClient } from "@/lib/auth-client";
import { useRouter } from "next/navigation";
import { Modal } from "@/components/ui/modal";
import { ArrowLeft, Loader2, Mic, MoveRight } from "lucide-react";
import { sendGTMEvent } from "@next/third-parties/google";
import posthog from "posthog-js";

import { authTokens as TOKEN } from "@/lib/design-tokens";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import constants from "@/constant.json";

interface AuthWizardProps {
  initialStep?: "welcome" | "signup" | "signin";
  onSuccess?: () => void;
}

function NotionInput(
  props: React.InputHTMLAttributes<HTMLInputElement> & {
    "aria-label"?: string;
  },
) {
  return (
    <Input {...props} className={cn("h-9 text-[13px]", props.className)} />
  );
}

function NotionLabel({
  htmlFor,
  children,
}: {
  htmlFor: string;
  children: React.ReactNode;
}) {
  return (
    <Label htmlFor={htmlFor} className="text-xs">
      {children}
    </Label>
  );
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

export function AuthWizard({
  initialStep = "welcome",
  onSuccess,
}: AuthWizardProps) {
  const [step, setStep] = useState<"welcome" | "signup" | "signin">(
    initialStep,
  );
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);

  const [modalOpen, setModalOpen] = useState(false);
  const [modalTitle, setModalTitle] = useState("");
  const [modalMessage, setModalMessage] = useState("");
  const [modalTone, setModalTone] = useState<"info" | "error" | "success">(
    "info",
  );

  const router = useRouter();

  const showModal = (
    title: string,
    message: string,
    tone: "info" | "error" | "success" = "info",
  ) => {
    setModalTitle(title);
    setModalMessage(message);
    setModalTone(tone);
    setModalOpen(true);
  };

  const handleSuccess = () => {
    if (onSuccess) {
      onSuccess();
    } else {
      router.push("/");
    }
  };

  const handleSignup = async () => {
    if (!email || !password || !name) {
      showModal(
        "Missing fields",
        "Please fill in every field to continue.",
        "error",
      );
      return;
    }
    setLoading(true);
    try {
      await authClient.signUp.email(
        { email, password, name },
        {
          onSuccess: () => {
            sendGTMEvent({ event: "signup", value: "email" });
            posthog.identify(email, { email, name });
            posthog.capture("user_signed_up", { method: "email", email });
            showModal(
              "Account created",
              "We're taking you to your workspace.",
              "success",
            );
            setTimeout(() => handleSuccess(), 1200);
          },
          onError: (ctx) => {
            sendGTMEvent({ event: "signup_error", error: ctx.error.message });
            posthog.capture("signup_error", {
              error_message: ctx.error.message,
              email,
            });
            posthog.captureException(new Error(ctx.error.message));
            showModal("Sign up failed", ctx.error.message, "error");
            setLoading(false);
          },
        },
      );
    } catch (e: unknown) {
      const msg =
        e instanceof Error ? e.message : "An unexpected error occurred";
      showModal("Something went wrong", msg, "error");
      setLoading(false);
    }
  };

  const handleSignin = async () => {
    if (!email || !password) {
      showModal(
        "Missing fields",
        "Enter your email and password to sign in.",
        "error",
      );
      return;
    }
    setLoading(true);
    try {
      await authClient.signIn.email(
        { email, password },
        {
          onSuccess: () => {
            sendGTMEvent({ event: "login", value: "email" });
            posthog.identify(email, { email });
            posthog.capture("user_signed_in", { method: "email", email });
            handleSuccess();
          },
          onError: (ctx) => {
            sendGTMEvent({ event: "login_error", error: ctx.error.message });
            posthog.capture("signin_error", {
              error_message: ctx.error.message,
              email,
            });
            posthog.captureException(new Error(ctx.error.message));
            showModal("Sign in failed", ctx.error.message, "error");
            setLoading(false);
          },
        },
      );
    } catch (e: unknown) {
      const msg =
        e instanceof Error ? e.message : "An unexpected error occurred";
      showModal("Something went wrong", msg, "error");
      setLoading(false);
    }
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
              color: "#ffffff",
              border: "none",
              padding: "8px 16px",
              borderRadius: 8,
              fontSize: 13,
              fontWeight: 600,
              cursor: "pointer",
              boxShadow:
                "0 0 0 1px rgba(34, 197, 94, 0.30), 0 0 16px rgba(34, 197, 94, 0.20)",
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
              background: "linear-gradient(135deg, #22c55e, #10b981, #059669)",
              color: "#ffffff",
              borderRadius: 7,
              boxShadow: "0 0 12px rgba(34, 197, 94, 0.28)",
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
              {constants.displayName}
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
            {step === "welcome" && "Welcome back"}
            {step === "signup" && "Create your account"}
            {step === "signin" && "Sign in to your account"}
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
            {step === "welcome" && "Pick how you'd like to continue."}
            {step === "signup" && "All you need is an email and a password."}
            {step === "signin" && "Enter your email and password below."}
          </p>
        </div>

        <div>
          {step === "welcome" && (
            <div className="grid gap-2">
              <NotionPrimaryButton onClick={() => setStep("signup")}>
                Create account
                <MoveRight className="h-3.5 w-3.5" />
              </NotionPrimaryButton>
              <NotionSecondaryButton onClick={() => setStep("signin")}>
                Sign in
              </NotionSecondaryButton>

              <div
                className="mt-3 flex items-start gap-2 rounded-md px-2.5 py-2"
                style={{
                  backgroundColor: TOKEN.accentSoft,
                  border: `1px solid ${TOKEN.accentBorder}`,
                }}
              >
                <span
                  className="mt-0.5 inline-flex items-center justify-center rounded"
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
                  New accounts go through a quick admin approval. You&apos;ll be
                  able to message the admin from the next screen.
                </p>
              </div>
            </div>
          )}

          {step === "signup" && (
            <div className="grid gap-3">
              <div className="grid gap-1">
                <NotionLabel htmlFor="name">Name</NotionLabel>
                <NotionInput
                  id="name"
                  placeholder="Jane Doe"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  autoComplete="name"
                />
              </div>
              <div className="grid gap-1">
                <NotionLabel htmlFor="email">Work email</NotionLabel>
                <NotionInput
                  id="email"
                  type="email"
                  placeholder="you@company.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoComplete="email"
                />
              </div>
              <div className="grid gap-1">
                <NotionLabel htmlFor="password">Password</NotionLabel>
                <NotionInput
                  id="password"
                  type="password"
                  placeholder="At least 8 characters"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="new-password"
                />
              </div>
              <NotionPrimaryButton onClick={handleSignup} loading={loading}>
                {loading ? "Creating account…" : "Create account"}
              </NotionPrimaryButton>
              <p
                style={{
                  color: TOKEN.steel,
                  fontSize: 11.5,
                  textAlign: "center",
                  margin: 0,
                }}
              >
                Already have an account?{" "}
                <button
                  type="button"
                  onClick={() => setStep("signin")}
                  style={{
                    color: TOKEN.accent,
                    fontWeight: 600,
                    background: "none",
                    border: "none",
                    padding: 0,
                    cursor: "pointer",
                  }}
                >
                  Sign in
                </button>
              </p>
            </div>
          )}

          {step === "signin" && (
            <div className="grid gap-3">
              <div className="grid gap-1">
                <NotionLabel htmlFor="email">Email</NotionLabel>
                <NotionInput
                  id="email"
                  type="email"
                  placeholder="you@company.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoComplete="email"
                />
              </div>
              <div className="grid gap-1">
                <NotionLabel htmlFor="password">Password</NotionLabel>
                <NotionInput
                  id="password"
                  type="password"
                  placeholder="Your password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="current-password"
                />
              </div>
              <NotionPrimaryButton onClick={handleSignin} loading={loading}>
                {loading ? "Signing in…" : "Sign in"}
              </NotionPrimaryButton>
              <p
                style={{
                  color: TOKEN.steel,
                  fontSize: 11.5,
                  textAlign: "center",
                  margin: 0,
                }}
              >
                Don&apos;t have an account?{" "}
                <button
                  type="button"
                  onClick={() => setStep("signup")}
                  style={{
                    color: TOKEN.accent,
                    fontWeight: 600,
                    background: "none",
                    border: "none",
                    padding: 0,
                    cursor: "pointer",
                  }}
                >
                  Create account
                </button>
              </p>
            </div>
          )}

          {step !== "welcome" && (
            <button
              type="button"
              onClick={() => setStep("welcome")}
              className="mt-4 inline-flex items-center gap-1"
              style={{
                color: TOKEN.steel,
                fontSize: 11.5,
                background: "none",
                border: "none",
                padding: 0,
                cursor: "pointer",
              }}
            >
              <ArrowLeft className="h-3 w-3" />
              Back
            </button>
          )}
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
