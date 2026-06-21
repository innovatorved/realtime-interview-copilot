"use client";

import { useSupportMessages } from "@/hooks/useSupportMessages";
import {
  ArrowLeft,
  CheckCircle2,
  Clock,
  Loader2,
  MessageSquarePlus,
  RefreshCw,
} from "lucide-react";
import posthog from "posthog-js";
import { useEffect, useMemo, useState } from "react";

// Single source of truth for the auth chrome palette; the wizard pulls
// from the same module.
import { authTokens as TOKEN } from "@/lib/design-tokens";

const MAX_BODY = 2000;
const MAX_SUBJECT = 200;

function PrimaryButton({
  children,
  loading,
  disabled,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { loading?: boolean }) {
  const isOff = disabled || loading;
  return (
    <button
      {...rest}
      disabled={isOff}
      style={{
        backgroundColor: isOff ? "rgba(255,255,255,0.06)" : TOKEN.accent,
        color: isOff ? TOKEN.stone : "#ffffff",
        border: "none",
        height: 30,
        padding: "0 12px",
        borderRadius: 6,
        fontSize: 12,
        fontWeight: 600,
        lineHeight: 1.3,
        cursor: isOff ? "not-allowed" : "pointer",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
        transition: "background-color 150ms ease",
        boxShadow: isOff
          ? "none"
          : "0 1px 2px rgba(0,0,0,0.4), 0 0 0 1px rgba(34, 197, 94, 0.30), 0 0 16px rgba(34, 197, 94, 0.16)",
        ...(rest.style ?? {}),
      }}
      onMouseEnter={(e) => {
        if (!isOff) e.currentTarget.style.backgroundColor = TOKEN.accentHover;
        rest.onMouseEnter?.(e);
      }}
      onMouseLeave={(e) => {
        if (!isOff) e.currentTarget.style.backgroundColor = TOKEN.accent;
        rest.onMouseLeave?.(e);
      }}
    >
      {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
      {children}
    </button>
  );
}

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
        height: 30,
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

const inputStyle: React.CSSProperties = {
  backgroundColor: TOKEN.inputBg,
  color: TOKEN.ink,
  border: `1px solid ${TOKEN.hairlineStrong}`,
  borderRadius: 6,
  padding: "7px 10px",
  fontSize: 12.5,
  lineHeight: 1.4,
  width: "100%",
  outline: "none",
  fontFamily: "inherit",
  transition: "border-color 150ms ease, box-shadow 150ms ease",
  backdropFilter: "blur(8px)",
};

function FieldLabel({
  htmlFor,
  children,
}: {
  htmlFor: string;
  children: React.ReactNode;
}) {
  return (
    <label
      htmlFor={htmlFor}
      style={{
        color: TOKEN.charcoal,
        fontSize: 11,
        fontWeight: 500,
        display: "block",
        marginBottom: 4,
      }}
    >
      {children}
    </label>
  );
}

function focusOn(e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>) {
  e.currentTarget.style.border = `1px solid ${TOKEN.accentBorder}`;
  e.currentTarget.style.boxShadow = `0 0 0 3px ${TOKEN.accentRing}`;
}
function focusOff(e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>) {
  e.currentTarget.style.border = `1px solid ${TOKEN.hairlineStrong}`;
  e.currentTarget.style.boxShadow = "none";
}

export function WaitingForApproval({ email }: { email?: string }) {
  const {
    threads,
    isLoading,
    error: listError,
    refresh,
    send,
    fetchThread,
  } = useSupportMessages({ enabled: true, pollMs: 60_000 });

  const [view, setView] = useState<"home" | "compose" | "thread">("home");
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [threadMessages, setThreadMessages] = useState<
    { id: string; body: string; authorType: string; createdAt: string }[]
  >([]);
  const [threadLoading, setThreadLoading] = useState(false);

  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [reply, setReply] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [sentBanner, setSentBanner] = useState(false);

  const handleCheckStatus = () => {
    posthog.capture("approval_status_checked", { email });
    window.location.reload();
  };

  const handleOpenThread = async (threadId: string) => {
    setView("thread");
    setActiveThreadId(threadId);
    setThreadLoading(true);
    setThreadMessages([]);
    const data = await fetchThread(threadId);
    if (data?.messages) {
      setThreadMessages(
        data.messages.map((m) => ({
          id: m.id,
          body: m.body,
          authorType: m.authorType,
          createdAt: m.createdAt,
        })),
      );
    }
    setThreadLoading(false);
  };

  const handleSend = async () => {
    setSendError(null);
    if (body.trim().length === 0) {
      setSendError("Please write a message before sending.");
      return;
    }
    if (body.length > MAX_BODY) {
      setSendError(`Message must be ${MAX_BODY} characters or fewer.`);
      return;
    }
    setSending(true);
    const created = await send({
      body: body.trim(),
      subject: subject.trim() || undefined,
    });
    setSending(false);
    if (!created) {
      setSendError(
        "Could not send your message. Please check your connection and try again.",
      );
      return;
    }
    posthog.capture("support_message_sent", { email, parentId: null });
    setSubject("");
    setBody("");
    setSentBanner(true);
    setView("home");
    void refresh();
  };

  const handleSendReply = async () => {
    if (!activeThreadId) return;
    setSendError(null);
    if (reply.trim().length === 0) {
      setSendError("Reply cannot be empty.");
      return;
    }
    if (reply.length > MAX_BODY) {
      setSendError(`Reply must be ${MAX_BODY} characters or fewer.`);
      return;
    }
    setSending(true);
    const created = await send({
      body: reply.trim(),
      parentId: activeThreadId,
    });
    setSending(false);
    if (!created) {
      setSendError("Could not send your reply. Please try again.");
      return;
    }
    posthog.capture("support_message_sent", {
      email,
      parentId: activeThreadId,
    });
    setReply("");
    void handleOpenThread(activeThreadId);
  };

  useEffect(() => {
    if (sentBanner) {
      const t = window.setTimeout(() => setSentBanner(false), 4000);
      return () => window.clearTimeout(t);
    }
  }, [sentBanner]);

  const sortedThreads = useMemo(
    () => [...threads].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    [threads],
  );

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
          // Cap the card so adding more threads / messages never grows it.
          // Inner scroll regions handle overflow instead.
          maxHeight: "min(560px, 85vh)",
          boxShadow:
            "0 4px 12px rgba(0,0,0,0.4), 0 24px 48px -16px rgba(0,0,0,0.5)",
          overflow: "hidden",
        }}
      >
        <div
          className="flex items-start gap-2.5 shrink-0"
          style={{ padding: "20px 22px 12px" }}
        >
          <div
            className="flex h-7 w-7 items-center justify-center shrink-0"
            style={{
              backgroundColor: TOKEN.skySoft,
              color: TOKEN.sky,
              borderRadius: 7,
              border: `1px solid ${TOKEN.skyBorder}`,
            }}
          >
            <Clock className="h-3.5 w-3.5" />
          </div>
          <div className="min-w-0">
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
            <p
              style={{
                color: TOKEN.slate,
                fontSize: 12,
                lineHeight: 1.5,
                margin: "3px 0 0",
              }}
            >
              We sent your access request{email ? " for " : ""}
              {email ? (
                <span style={{ color: TOKEN.charcoal, fontWeight: 500 }}>
                  {email}
                </span>
              ) : null}
              . Most accounts are approved within a few hours.
            </p>
          </div>
        </div>

        {/* Body: bounded, scrolls internally so the card never grows. */}
        <div
          className="flex-1 min-h-0 flex flex-col"
          style={{ padding: "0 22px 20px" }}
        >
          {sentBanner && (
            <div
              className="mb-3 flex items-center gap-2 px-2.5 py-1.5 rounded-md shrink-0"
              style={{
                backgroundColor: TOKEN.accentSoft,
                border: `1px solid ${TOKEN.accentBorder}`,
                color: TOKEN.accentText,
                fontSize: 11.5,
                fontWeight: 500,
              }}
            >
              <CheckCircle2 className="h-3.5 w-3.5" />
              <span>Message sent. The admin will reply right here.</span>
            </div>
          )}

          {view === "home" && (
            <div className="flex flex-col flex-1 min-h-0">
              <div className="flex flex-wrap gap-1.5 mb-3 shrink-0">
                <PrimaryButton onClick={() => setView("compose")}>
                  <MessageSquarePlus className="h-3.5 w-3.5" />
                  Message admin
                </PrimaryButton>
                <SecondaryButton onClick={handleCheckStatus}>
                  <RefreshCw className="h-3.5 w-3.5" />
                  Check status
                </SecondaryButton>
              </div>

              <div
                className="rounded-md overflow-hidden flex-1 min-h-0 flex flex-col"
                style={{
                  border: `1px solid ${TOKEN.hairline}`,
                  backgroundColor: TOKEN.surfaceMid,
                }}
              >
                <div
                  className="flex items-center justify-between px-3 py-2 shrink-0"
                  style={{
                    backgroundColor: TOKEN.surfaceSoft,
                    borderBottom: `1px solid ${TOKEN.hairline}`,
                  }}
                >
                  <span
                    style={{
                      color: TOKEN.charcoal,
                      fontSize: 9.5,
                      fontWeight: 600,
                      letterSpacing: "0.6px",
                      textTransform: "uppercase",
                    }}
                  >
                    Your conversations
                  </span>
                  <span style={{ color: TOKEN.steel, fontSize: 10.5 }}>
                    {sortedThreads.length} thread
                    {sortedThreads.length === 1 ? "" : "s"}
                  </span>
                </div>
                <ul className="flex-1 min-h-0 overflow-y-auto custom-scrollbar">
                  {isLoading && sortedThreads.length === 0 && (
                    <li
                      className="px-3 py-2.5 flex items-center gap-2"
                      style={{ color: TOKEN.steel, fontSize: 11.5 }}
                    >
                      <Loader2 className="h-3 w-3 animate-spin" />
                      Loading…
                    </li>
                  )}
                  {!isLoading && sortedThreads.length === 0 && (
                    <li
                      className="px-3 py-5 text-center"
                      style={{ color: TOKEN.steel, fontSize: 11.5 }}
                    >
                      No conversations yet. Send the admin a quick note about
                      who you are or why you need access.
                    </li>
                  )}
                  {sortedThreads.map((t, i) => (
                    <li
                      key={t.id}
                      style={{
                        borderTop:
                          i === 0 ? "none" : `1px solid ${TOKEN.hairlineSoft}`,
                      }}
                    >
                      <button
                        type="button"
                        className="w-full text-left px-3 py-2"
                        style={{
                          backgroundColor: "transparent",
                          border: "none",
                          cursor: "pointer",
                          transition: "background-color 120ms ease",
                        }}
                        onClick={() => void handleOpenThread(t.id)}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.backgroundColor =
                            "rgba(255,255,255,0.04)";
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.backgroundColor = "transparent";
                        }}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span
                            className="truncate"
                            style={{
                              color: TOKEN.ink,
                              fontSize: 12.5,
                              fontWeight: 500,
                            }}
                          >
                            {t.subject || "(no subject)"}
                          </span>
                          <div className="flex items-center gap-1.5 shrink-0">
                            {t.unreadByUser && (
                              <span
                                title="New admin reply"
                                style={{
                                  width: 6,
                                  height: 6,
                                  borderRadius: 9999,
                                  backgroundColor: TOKEN.accent,
                                  display: "inline-block",
                                  boxShadow: "0 0 6px rgba(34, 197, 94, 0.65)",
                                }}
                              />
                            )}
                            <span
                              style={{
                                color:
                                  t.status === "open"
                                    ? TOKEN.accentText
                                    : TOKEN.steel,
                                backgroundColor:
                                  t.status === "open"
                                    ? TOKEN.accentSoft
                                    : "rgba(255,255,255,0.05)",
                                border: `1px solid ${
                                  t.status === "open"
                                    ? TOKEN.accentBorder
                                    : TOKEN.hairlineStrong
                                }`,
                                fontSize: 9.5,
                                fontWeight: 600,
                                padding: "1px 6px",
                                borderRadius: 4,
                                textTransform: "capitalize",
                              }}
                            >
                              {t.status}
                            </span>
                          </div>
                        </div>
                        <p
                          className="truncate"
                          style={{
                            color: TOKEN.slate,
                            fontSize: 11.5,
                            margin: "3px 0 0",
                          }}
                        >
                          {t.body}
                        </p>
                        <p
                          style={{
                            color: TOKEN.stone,
                            fontSize: 10,
                            margin: "3px 0 0",
                          }}
                        >
                          {new Date(t.updatedAt).toLocaleString()}
                        </p>
                      </button>
                    </li>
                  ))}
                </ul>
                {listError && (
                  <p
                    className="px-3 py-1.5 shrink-0"
                    style={{
                      color: TOKEN.semanticError,
                      fontSize: 11,
                      backgroundColor: TOKEN.semanticErrorSoft,
                      borderTop: `1px solid ${TOKEN.hairline}`,
                    }}
                  >
                    {listError}
                  </p>
                )}
              </div>
            </div>
          )}

          {view === "compose" && (
            <div className="flex flex-col flex-1 min-h-0">
              <button
                type="button"
                onClick={() => {
                  setSendError(null);
                  setView("home");
                }}
                className="mb-3 inline-flex items-center gap-1 self-start shrink-0"
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

              {/* Scrollable form area so long messages don't grow the card. */}
              <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar pr-1">
                <div className="mb-3">
                  <FieldLabel htmlFor="support-subject">
                    Subject (optional)
                  </FieldLabel>
                  <input
                    id="support-subject"
                    value={subject}
                    onChange={(e) =>
                      setSubject(e.target.value.slice(0, MAX_SUBJECT))
                    }
                    placeholder="Why I need access"
                    maxLength={MAX_SUBJECT}
                    style={inputStyle}
                    onFocus={focusOn}
                    onBlur={focusOff}
                  />
                </div>

                <div className="mb-2">
                  <FieldLabel htmlFor="support-body">Message</FieldLabel>
                  <textarea
                    id="support-body"
                    value={body}
                    onChange={(e) => setBody(e.target.value.slice(0, MAX_BODY))}
                    placeholder="Tell the admin a bit about yourself and why you need access…"
                    rows={5}
                    maxLength={MAX_BODY}
                    style={{ ...inputStyle, resize: "none", minHeight: 110 }}
                    onFocus={focusOn}
                    onBlur={focusOff}
                  />
                  <p
                    className="text-right"
                    style={{
                      color: TOKEN.stone,
                      fontSize: 10,
                      margin: "4px 0 0",
                    }}
                  >
                    {body.length}/{MAX_BODY}
                  </p>
                </div>
              </div>

              {sendError && (
                <p
                  className="shrink-0"
                  style={{
                    color: TOKEN.semanticError,
                    fontSize: 11,
                    margin: "0 0 8px",
                  }}
                >
                  {sendError}
                </p>
              )}

              <div className="flex justify-end gap-1.5 mt-2 shrink-0">
                <SecondaryButton
                  onClick={() => {
                    setSendError(null);
                    setView("home");
                  }}
                >
                  Cancel
                </SecondaryButton>
                <PrimaryButton
                  onClick={() => void handleSend()}
                  loading={sending}
                  disabled={body.trim().length === 0}
                >
                  {sending ? "Sending…" : "Send to admin"}
                </PrimaryButton>
              </div>
            </div>
          )}

          {view === "thread" && (
            <div className="flex flex-col flex-1 min-h-0">
              <button
                type="button"
                onClick={() => {
                  setView("home");
                  setActiveThreadId(null);
                  setThreadMessages([]);
                  void refresh();
                }}
                className="mb-3 inline-flex items-center gap-1 self-start shrink-0"
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
                Back to conversations
              </button>

              <div
                className="rounded-md flex-1 min-h-0 overflow-y-auto custom-scrollbar p-2 mb-3 space-y-1.5"
                style={{
                  backgroundColor: TOKEN.surfaceMid,
                  border: `1px solid ${TOKEN.hairline}`,
                }}
              >
                {threadLoading && (
                  <p
                    className="flex items-center gap-2 px-1 py-1"
                    style={{ color: TOKEN.steel, fontSize: 11.5 }}
                  >
                    <Loader2 className="h-3 w-3 animate-spin" />
                    Loading…
                  </p>
                )}
                {!threadLoading && threadMessages.length === 0 && (
                  <p
                    style={{
                      color: TOKEN.steel,
                      fontSize: 11.5,
                      padding: "4px",
                    }}
                  >
                    No messages.
                  </p>
                )}
                {threadMessages.map((m) => {
                  const isAdmin = m.authorType === "admin";
                  return (
                    <div
                      key={m.id}
                      className="rounded-md px-2.5 py-1.5"
                      style={{
                        backgroundColor: isAdmin
                          ? TOKEN.accentSoft
                          : "rgba(255,255,255,0.04)",
                        border: `1px solid ${
                          isAdmin ? TOKEN.accentBorder : TOKEN.hairlineStrong
                        }`,
                      }}
                    >
                      <div className="flex items-center justify-between gap-2 mb-0.5">
                        <span
                          style={{
                            color: isAdmin ? TOKEN.accentText : TOKEN.charcoal,
                            fontSize: 9.5,
                            fontWeight: 600,
                            textTransform: "uppercase",
                            letterSpacing: "0.6px",
                          }}
                        >
                          {isAdmin ? "Admin" : "You"}
                        </span>
                        <span style={{ color: TOKEN.stone, fontSize: 9.5 }}>
                          {new Date(m.createdAt).toLocaleString()}
                        </span>
                      </div>
                      <p
                        className="whitespace-pre-wrap break-words"
                        style={{
                          color: TOKEN.charcoal,
                          fontSize: 12,
                          lineHeight: 1.5,
                          margin: 0,
                        }}
                      >
                        {m.body}
                      </p>
                    </div>
                  );
                })}
              </div>

              <div className="mb-2 shrink-0">
                <FieldLabel htmlFor="support-reply">Reply</FieldLabel>
                <textarea
                  id="support-reply"
                  value={reply}
                  onChange={(e) => setReply(e.target.value.slice(0, MAX_BODY))}
                  placeholder="Add to this conversation…"
                  rows={2}
                  maxLength={MAX_BODY}
                  style={{ ...inputStyle, resize: "none", minHeight: 60 }}
                  onFocus={focusOn}
                  onBlur={focusOff}
                />
                <p
                  className="text-right"
                  style={{
                    color: TOKEN.stone,
                    fontSize: 10,
                    margin: "4px 0 0",
                  }}
                >
                  {reply.length}/{MAX_BODY}
                </p>
              </div>

              {sendError && (
                <p
                  className="shrink-0"
                  style={{
                    color: TOKEN.semanticError,
                    fontSize: 11,
                    margin: "0 0 8px",
                  }}
                >
                  {sendError}
                </p>
              )}

              <div className="flex justify-end shrink-0">
                <PrimaryButton
                  onClick={() => void handleSendReply()}
                  loading={sending}
                  disabled={reply.trim().length === 0}
                >
                  {sending ? "Sending…" : "Send reply"}
                </PrimaryButton>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
