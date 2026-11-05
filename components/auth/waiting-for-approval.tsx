"use client";

import { RefreshCw } from "lucide-react";
import posthog from "posthog-js";
import { LogoMark } from "@/components/brand/v-logo";
import { authClient } from "@/lib/auth-client";
import { APPROVAL_CONTACT_EMAIL, GITHUB_REPO_URL } from "@/lib/constant";
import { authTokens as TOKEN } from "@/lib/design-tokens";

function SecondaryButton({
  children,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...rest}
      style={{
        backgroundColor: "rgba(255,255,255,0.04)",
        color: TOKEN.ink,
        border: `1px solid ${TOKEN.hairlineStrong}`,
        height: 32,
        padding: "0 12px",
        borderRadius: 6,
        fontSize: 12,
        fontWeight: 500,
        lineHeight: 1.3,
        cursor: "pointer",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
        transition: "background-color 150ms ease",
        backdropFilter: "blur(8px)",
        ...(rest.style ?? {}),
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.backgroundColor = "rgba(255,255,255,0.08)";
        rest.onMouseEnter?.(e);
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.backgroundColor = "rgba(255,255,255,0.04)";
        rest.onMouseLeave?.(e);
      }}
    >
      {children}
    </button>
  );
}

function openSafeUrl(url: string) {
  if (window.electronAPI?.openExternal) {
    void window.electronAPI.openExternal(url);
  } else {
    window.open(url, "_blank", "noopener,noreferrer");
  }
}

function renderBodyWithLinks(text: string) {
  const urlRegex =
    /(https?:\/\/[^\s]+|[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/g;
  const parts = text.split(urlRegex);
  return parts.map((part, idx) => {
    if (/^https?:\/\/[^\s]+$/.test(part)) {
      return (
        <a
          key={idx}
          href={part}
          onClick={(e) => {
            e.preventDefault();
            openSafeUrl(part);
          }}
          style={{
            color: TOKEN.sky,
            textDecoration: "underline",
            wordBreak: "break-all",
            cursor: "pointer",
          }}
        >
          {part}
        </a>
      );
    }
    if (/^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(part)) {
      return (
        <a
          key={idx}
          href={`mailto:${part}`}
          style={{
            color: TOKEN.sky,
            textDecoration: "underline",
            cursor: "pointer",
          }}
        >
          {part}
        </a>
      );
    }
    return part;
  });
}

export function WaitingForApproval({ email }: { email?: string }) {
  const handleCheckStatus = () => {
    posthog.capture("approval_status_checked", { email });
    window.location.reload();
  };

  const messageBody = `Hi there,

Thank you for reaching out and for your interest in Realtime Interview Copilot!

Could you please star our GitHub repository here:
${GITHUB_REPO_URL}

I (Ved) am reviewing requests and approving access for everyone in batches. If you need urgent access or have questions, feel free to email me directly at ${APPROVAL_CONTACT_EMAIL}. You will also receive an email notification as soon as your account is approved.

Thanks so much for your patience and support!
— Ved Gupta`;

  return (
    <div
      className="min-h-screen w-full flex items-center justify-center px-4 py-10"
      style={{ backgroundColor: TOKEN.pageBg }}
    >
      <div
        className="w-full max-w-md flex flex-col"
        style={{
          backgroundColor: TOKEN.cardBg,
          backdropFilter: "blur(24px)",
          WebkitBackdropFilter: "blur(24px)",
          border: `1px solid ${TOKEN.cardBorder}`,
          borderRadius: 12,
          boxShadow:
            "0 4px 12px rgba(0,0,0,0.4), 0 24px 48px -16px rgba(0,0,0,0.5)",
          overflow: "hidden",
        }}
      >
        {/* Header */}
        <div
          className="flex items-start gap-2.5 shrink-0"
          style={{ padding: "20px 22px 14px" }}
        >
          <LogoMark size="sm" />
          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-2 mb-0.5">
              <h1
                style={{
                  color: TOKEN.ink,
                  fontSize: 16,
                  fontWeight: 600,
                  lineHeight: 1.25,
                  letterSpacing: "-0.2px",
                  margin: 0,
                }}
              >
                Waiting for admin approval
              </h1>
              <span className="eco-pill eco-pill--blue shrink-0">
                <span className="h-1.5 w-1.5 rounded-full bg-info" />
                PENDING
              </span>
            </div>
            <p
              style={{
                color: TOKEN.slate,
                fontSize: 12,
                lineHeight: 1.5,
                margin: "4px 0 0",
              }}
            >
              We received your access request{email ? " for " : ""}
              {email ? (
                <span style={{ color: TOKEN.charcoal, fontWeight: 500 }}>
                  {email}
                </span>
              ) : null}
              . Access is currently being rolled out in batches.
            </p>
          </div>
        </div>

        {/* Body */}
        <div
          className="flex-1 min-h-0 flex flex-col"
          style={{ padding: "0 22px 20px" }}
        >
          {/* Action buttons (same format as original screen) */}
          <div className="flex flex-wrap gap-2 mb-3 shrink-0">
            <SecondaryButton onClick={handleCheckStatus}>
              <RefreshCw className="h-3.5 w-3.5" />
              Check status
            </SecondaryButton>
            <SecondaryButton
              onClick={() => openSafeUrl("https://sso.vedgupta.in/pending")}
            >
              SSO Portal
            </SecondaryButton>
          </div>

          {/* Admin message container & bubble (exact same UI format as support thread) */}
          <div
            className="rounded-md overflow-hidden flex flex-col p-3 mb-4"
            style={{
              border: `1px solid ${TOKEN.hairline}`,
              backgroundColor: TOKEN.surfaceMid,
            }}
          >
            <div
              className="rounded-md px-3 py-2.5"
              style={{
                backgroundColor: TOKEN.accentSoft,
                border: `1px solid ${TOKEN.accentBorder}`,
              }}
            >
              <div className="flex items-center justify-between gap-2 mb-1.5">
                <span
                  style={{
                    color: TOKEN.accentText,
                    fontSize: 10,
                    fontWeight: 600,
                    textTransform: "uppercase",
                    letterSpacing: "0.6px",
                  }}
                >
                  Admin
                </span>
                <span style={{ color: TOKEN.stone, fontSize: 10 }}>
                  Auto-Response
                </span>
              </div>
              <p
                className="whitespace-pre-wrap break-words"
                style={{
                  color: TOKEN.charcoal,
                  fontSize: 12,
                  lineHeight: 1.55,
                  margin: 0,
                }}
              >
                {renderBodyWithLinks(messageBody)}
              </p>
            </div>
          </div>

          {/* Sign Out Link */}
          <div
            className="text-center pt-2 border-t"
            style={{ borderColor: TOKEN.hairlineSoft }}
          >
            <button
              type="button"
              onClick={() => {
                void authClient.signOut();
                window.dispatchEvent(new Event("auth:logout"));
              }}
              style={{
                background: "none",
                border: "none",
                color: TOKEN.steel,
                fontSize: 11.5,
                fontWeight: 500,
                cursor: "pointer",
                padding: "6px 8px",
                transition: "color 150ms ease",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.color = TOKEN.ink;
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.color = TOKEN.steel;
              }}
            >
              Sign out of this account
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
