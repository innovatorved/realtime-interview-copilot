"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { BACKEND_API_URL } from "@/lib/constant";
import { clearByokConfig } from "@/lib/byok-client";

interface ProviderStatus {
  configured: boolean;
  provider: "deepgram" | "openai";
  baseUrl: string;
  tokenLast4: string;
  modelName: string | null;
  active: boolean;
  disabledByAdmin: boolean;
}

interface ByokStatus {
  enabled: boolean;
  deepgram: ProviderStatus | null;
  openai: ProviderStatus | null;
}

type LoadState = "loading" | "ready" | "disabled" | "error";

async function refreshElectronCsp(): Promise<void> {
  try {
    const api = (window as unknown as {
      electronAPI?: { refreshCsp?: () => Promise<void> };
    }).electronAPI;
    if (api?.refreshCsp) {
      await api.refreshCsp();
    }
  } catch {
    // Best-effort; the renderer still works against the worker fallback
    // even if the CSP refresh fails.
  }
}

export function ByokSettingsPage() {
  const [state, setState] = useState<LoadState>("loading");
  const [status, setStatus] = useState<ByokStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadStatus = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch(`${BACKEND_API_URL}/api/byok/status`, {
        credentials: "include",
        cache: "no-store",
      });
      if (res.status === 403) {
        setState("disabled");
        return;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as ByokStatus;
      setStatus(data);
      setState("ready");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load status");
      setState("error");
    }
  }, []);

  useEffect(() => {
    loadStatus();
  }, [loadStatus]);

  const onSaved = useCallback(async () => {
    clearByokConfig();
    await refreshElectronCsp();
    await loadStatus();
  }, [loadStatus]);

  if (state === "loading") {
    return (
      <div className="min-h-screen flex items-center justify-center text-zinc-400 text-sm">
        Loading BYOK settings…
      </div>
    );
  }

  if (state === "disabled") {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <div className="glass-card p-8 max-w-md text-center space-y-3">
          <h1 className="text-lg font-semibold text-white">
            BYOK is not enabled for your account
          </h1>
          <p className="text-sm text-zinc-400">
            Bring-your-own-keys lets you point this app at your own
            Deepgram-compatible and OpenAI-compatible endpoints. Contact
            your administrator to enable the <code>byok</code> feature
            flag for your account.
          </p>
        </div>
      </div>
    );
  }

  if (state === "error") {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <div className="glass-card p-6 max-w-md text-center space-y-3">
          <p className="text-sm text-red-300">{error ?? "Unknown error"}</p>
          <Button onClick={loadStatus} className="text-xs">
            Retry
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen px-4 py-10">
      <div className="max-w-3xl mx-auto space-y-6">
        <header>
          <h1 className="text-xl font-semibold text-white">
            Bring Your Own Keys
          </h1>
          <p className="text-xs text-zinc-500 mt-1">
            Use your own Deepgram-compatible and OpenAI-compatible endpoints.
            Tokens are encrypted at rest and only ever sent to the URL you
            provide. Leave a card empty to fall back to the shared service.
          </p>
        </header>

        <ProviderCard
          title="Deepgram-compatible (live transcription)"
          provider="deepgram"
          status={status?.deepgram ?? null}
          requireModel={false}
          urlHint="e.g. https://api.deepgram.com or wss://your-host"
          tokenHint="Deepgram project API key"
          onChange={onSaved}
        />

        <ProviderCard
          title="OpenAI-compatible (completions)"
          provider="openai"
          status={status?.openai ?? null}
          requireModel
          urlHint="e.g. https://api.openai.com/v1"
          tokenHint="Bearer token / API key"
          onChange={onSaved}
        />
      </div>
    </div>
  );
}

interface ProviderCardProps {
  title: string;
  provider: "deepgram" | "openai";
  status: ProviderStatus | null;
  requireModel: boolean;
  urlHint: string;
  tokenHint: string;
  onChange: () => Promise<void> | void;
}

function ProviderCard({
  title,
  provider,
  status,
  requireModel,
  urlHint,
  tokenHint,
  onChange,
}: ProviderCardProps) {
  const [baseUrl, setBaseUrl] = useState(status?.baseUrl ?? "");
  const [token, setToken] = useState("");
  const [modelName, setModelName] = useState(status?.modelName ?? "");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  useEffect(() => {
    setBaseUrl(status?.baseUrl ?? "");
    setModelName(status?.modelName ?? "");
  }, [status?.baseUrl, status?.modelName]);

  const handleSave = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const body: Record<string, unknown> = { provider, baseUrl, token };
      if (requireModel) body.modelName = modelName;

      const res = await fetch(`${BACKEND_API_URL}/api/byok/credential`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }
      setToken("");
      setMsg({ kind: "ok", text: "Saved." });
      await onChange();
    } catch (e) {
      setMsg({ kind: "error", text: e instanceof Error ? e.message : "Failed to save" });
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async () => {
    if (!status?.configured) return;
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch(
        `${BACKEND_API_URL}/api/byok/credential/${encodeURIComponent(provider)}`,
        { method: "DELETE", credentials: "include" },
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setBaseUrl("");
      setModelName("");
      setMsg({ kind: "ok", text: "Removed." });
      await onChange();
    } catch (e) {
      setMsg({ kind: "error", text: e instanceof Error ? e.message : "Failed to delete" });
    } finally {
      setBusy(false);
    }
  };

  const handleToggle = async (active: boolean) => {
    if (!status?.configured) return;
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch(
        `${BACKEND_API_URL}/api/byok/credential/${encodeURIComponent(provider)}/toggle`,
        {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ active }),
        },
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await onChange();
    } catch (e) {
      setMsg({ kind: "error", text: e instanceof Error ? e.message : "Failed to toggle" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="glass-card p-5 space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-white">{title}</h2>
          {status?.configured && (
            <p className="text-[11px] text-zinc-500 mt-1">
              Saved token ends in <code>{status.tokenLast4}</code>
              {status.disabledByAdmin && (
                <span className="ml-2 text-red-300">
                  Disabled by admin
                </span>
              )}
            </p>
          )}
        </div>
        {status?.configured && (
          <div className="flex items-center gap-2 text-[11px] text-zinc-400">
            Active
            <Switch
              checked={status.active && !status.disabledByAdmin}
              disabled={busy || status.disabledByAdmin}
              onCheckedChange={(v) => handleToggle(Boolean(v))}
            />
          </div>
        )}
      </div>

      <div className="space-y-3">
        <div className="space-y-1">
          <Label className="text-[11px] uppercase tracking-wider text-zinc-500">
            Base URL
          </Label>
          <Input
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder={urlHint}
            disabled={busy}
          />
        </div>

        <div className="space-y-1">
          <Label className="text-[11px] uppercase tracking-wider text-zinc-500">
            Token
          </Label>
          <Input
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder={status?.configured ? "Leave blank to keep current token" : tokenHint}
            disabled={busy}
            autoComplete="off"
          />
        </div>

        {requireModel && (
          <div className="space-y-1">
            <Label className="text-[11px] uppercase tracking-wider text-zinc-500">
              Model name
            </Label>
            <Input
              value={modelName}
              onChange={(e) => setModelName(e.target.value)}
              placeholder="e.g. gpt-4o-mini"
              disabled={busy}
            />
          </div>
        )}
      </div>

      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Button
            type="button"
            disabled={busy || !baseUrl || !token || (requireModel && !modelName)}
            onClick={handleSave}
            className="text-xs"
          >
            {busy ? "Saving…" : "Save"}
          </Button>
          {status?.configured && (
            <Button
              type="button"
              variant="ghost"
              disabled={busy}
              onClick={handleDelete}
              className="text-xs text-red-300 hover:text-red-200"
            >
              Remove
            </Button>
          )}
        </div>
        {msg && (
          <span
            className={
              msg.kind === "ok"
                ? "text-[11px] text-emerald-300"
                : "text-[11px] text-red-300"
            }
          >
            {msg.text}
          </span>
        )}
      </div>
    </section>
  );
}
