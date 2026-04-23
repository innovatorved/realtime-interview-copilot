# Realtime Interview Copilot — Architecture

> Complete walkthrough of how the app is built and how it works end-to-end:
> desktop audio capture, live transcription, AI answers with vision,
> authentication, deployment, release pipeline, and security.

---

## 1. What the product does

Realtime Interview Copilot is a desktop application that silently helps you
during online interviews. While you're on a Zoom / Google Meet / Teams call,
the app:

1. Captures the audio coming out of your speakers (interviewer's voice).
2. Transcribes it live with **Deepgram**.
3. Generates an AI answer for every question that appears in the transcript
   (Copilot) or summarizes the conversation on demand (Summarizer).
4. Lets you press `⌘⇧1` anywhere to snap your screen and ask AI about it
   (Ask AI with vision).
5. Stays invisible in screen shares so the interviewer never sees it.

All without requiring BlackHole, VB-Cable, Voicemeeter, or any virtual audio
driver.

---

## 2. High-level architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                         USER'S MACHINE                              │
│                                                                     │
│   ┌──────────────────────── Electron 41 app ──────────────────────┐ │
│   │                                                               │ │
│   │   Main process (Node.js)                                      │ │
│   │   ─────────────────────                                       │ │
│   │   - electron/main.ts                                          │ │
│   │   - Grants display-media + loopback audio                     │ │
│   │   - Registers ⌘⇧1 global hotkey                               │ │
│   │   - Provides screenshot + permission IPC                      │ │
│   │   - Hides window from screen-share via setContentProtection   │ │
│   │                                                               │ │
│   │            ▲ IPC via contextBridge (preload.ts)               │ │
│   │            ▼                                                  │ │
│   │                                                               │ │
│   │   Renderer (Next.js 16 + React 18)                            │ │
│   │   ───────────────────────────────                             │ │
│   │   - components/recorder.tsx    (capture + transcribe)         │ │
│   │   - components/copilot.tsx     (AI answers)                   │ │
│   │   - components/QuestionAssistant.tsx  (Ask AI + vision)       │ │
│   │   - hooks/useDeepgramTranscriber.ts   (WS streaming)          │ │
│   │                                                               │ │
│   └───────────────────────────────────────────────────────────────┘ │
│                 │                                  │                │
│        audio WS │                                  │ HTTPS          │
└─────────────────┼──────────────────────────────────┼────────────────┘
                  │                                  │
                  ▼                                  ▼
       ┌────────────────────┐          ┌───────────────────────────┐
       │  Deepgram          │          │  Cloudflare Workers API   │
       │  api.deepgram.com  │◄─────────│  realtime-worker-api      │
       │  nova-3 + diarize  │  issues  │  - Auth (Better Auth)     │
       └────────────────────┘  10-min  │  - Issues Deepgram tokens │
                              token    │  - Proxies AI completions │
                                       │  - D1 SQL (users, keys)   │
                                       └──────────┬────────────────┘
                                                  │
                                                  ▼
                          ┌──────────────────────────────────────┐
                          │   AI providers                       │
                          │   - Gemini (default)                 │
                          │   - Any OpenAI-compatible endpoint   │
                          └──────────────────────────────────────┘
```

Three independently deployable units:

| Unit | Runtime | Purpose |
|------|---------|---------|
| **Desktop app** | Electron 41, Node 20 | Capture audio, render UI, talk to the worker |
| **Worker API** | Cloudflare Workers | Auth, token issuance, model proxying, rate limiting |
| **Database** | Cloudflare D1 (SQLite) | Users, sessions, per-user config |

---

## 3. Audio capture — no virtual drivers

### 3.1 The key idea

In Electron 30+, the main process can intercept `getDisplayMedia` calls and
return a custom source. We say "give them the screen plus `audio: "loopback"`"
— and Chromium asks the OS to tap the system audio output as an input.

- **macOS**: backed by `ScreenCaptureKit` audio tap (macOS 13+).
- **Windows**: backed by `WASAPI loopback`.

Both are first-party OS APIs. No third-party driver. No reboots.

### 3.2 Code — main process

```ts
// electron/main.ts
session.defaultSession.setDisplayMediaRequestHandler(
  (request, callback) => {
    desktopCapturer
      .getSources({ types: ["screen"] })
      .then((sources) => {
        if (sources && sources.length > 0) {
          callback({
            video: sources[0],        // required, but we throw it away
            audio: "loopback",        // <-- the magic
          });
        } else {
          callback({} as any);
        }
      });
  },
  { useSystemPicker: false },         // skip the OS picker
);
```

We also auto-grant Chromium-level `media` / `display-capture` permissions so
no second prompt appears.

### 3.3 Code — renderer

```tsx
// components/recorder.tsx
const media = await navigator.mediaDevices.getDisplayMedia({
  video: true,
  audio: true,      // plain boolean, NOT an object — Electron 30+ rejects
                    // detailed constraints on display-capture audio tracks.
});

media.getVideoTracks().forEach((t) => t.stop());  // kill the video track
setStream(media);
```

The resulting `MediaStream` has exactly one live track: system audio.

### 3.4 First-run permission UX (macOS)

On macOS the OS shows the Screen Recording permission dialog once. We make
that experience frictionless:

1. On launch, `components/ScreenRecordingOnboard.tsx` checks
   `systemPreferences.getMediaAccessStatus('screen')` every 1.2 s.
2. If `!= "granted"`, we show a modal explaining why and with two buttons:
   **Enable Screen Recording** (opens System Settings → Privacy & Security via
   `shell.openExternal`) and **Later**.
3. After 8 s without a grant we surface an amber **Relaunch app** CTA — macOS
   caches TCC permission state per process, so a granted permission only
   takes effect on the next launch. The CTA calls `app.relaunch(); app.exit(0)`.
4. Polling auto-closes the modal the instant `"granted"` is detected.

---

## 4. Live transcription pipeline

### 4.1 Chunking the stream

`MediaStream` is a continuous live object. We wrap it in a `MediaRecorder`
with a 250 ms timeslice so the browser emits one encoded Opus Blob every
quarter second.

```ts
// hooks/useDeepgramTranscriber.ts
const recorder = new MediaRecorder(stream, {
  mimeType: "audio/webm;codecs=opus",   // picked per-platform
});
recorder.start(250);                     // emit a Blob every 250 ms
```

### 4.2 Ephemeral Deepgram token

**The Deepgram project key never ships in the binary.** Instead:

1. The desktop app asks the worker: `GET /api/deepgram-key`.
2. The worker validates the user's session, then calls Deepgram:
   ```
   POST https://api.deepgram.com/v1/projects/{id}/keys
     Authorization: Token <server-side-project-key>
     { scopes: ["usage:write"], time_to_live_in_seconds: 600 }
   ```
3. Deepgram returns a fresh, scoped 10-minute key. We pass that back to
   the app. Leaked = worst case 10 minutes of transcription abuse, no
   access to your usage dashboard or billing.

### 4.3 Streaming over WebSocket

```ts
const socket = new WebSocket(
  "wss://api.deepgram.com/v1/listen?" +
  "model=nova-3&diarize=true&language=multi&endpointing=450",
  ["token", apiKey],                   // auth via WS subprotocol
);

socket.onopen = () => {
  recorder.addEventListener("dataavailable", (event) => {
    if (event.data.size > 0 && socket.readyState === 1) {
      socket.send(event.data);         // ship each 250 ms chunk
    }
  });
};
```

| Query param | Meaning |
|---|---|
| `model=nova-3` | Deepgram's latest general-purpose model |
| `diarize=true` | Tag who said what (speaker 0, 1, …) |
| `language=multi` | Auto-detect spoken language |
| `endpointing=450` | Lock a sentence after 450 ms of silence |

### 4.4 Receiving transcripts

```ts
socket.onmessage = (message) => {
  const r = JSON.parse(message.data);
  if (r?.type !== "Results") return;

  const transcript = r.channel?.alternatives?.[0]?.transcript;
  if (!transcript) return;

  if (r.is_final) {
    const speaker = r.channel.alternatives[0].words?.[0]?.speaker ?? "?";
    setTranscripts((prev) => [
      ...prev,
      { transcript, speaker: `Speaker ${speaker}`, timestamp: now() },
    ]);
  } else {
    setInterimTranscript(transcript);   // the grey "typing" line
  }
};
```

Two React states drive the UI:

- `interimTranscript` — updates many times per second, rendered greyed out.
- `transcripts[]` — append-only finalized sentences with speaker + timestamp.

### 4.5 End-to-end latency budget

| Step | Typical time |
|---|---|
| OS loopback → Chromium stream | ~2 ms |
| `MediaRecorder` chunk | 250 ms (fixed) |
| Renderer → Deepgram (WS send) | 20–60 ms |
| Deepgram first partial response | 100–200 ms |
| **Total speaking → first text** | **~400 ms** |
| Silence → finalized sentence | +450 ms (endpointing) |

---

## 5. AI answers — Copilot, Summarizer, Ask AI

### 5.1 What each mode does

- **Copilot** (`components/copilot.tsx`): takes the latest interview-question
  slice of the transcript + your interview context ("Senior FE role at Acme,
  React/TS") and streams an answer in the first-person voice of the user.
- **Summarizer** (same component, different prompt): condenses the whole
  conversation so far.
- **Ask AI** (`components/QuestionAssistant.tsx`): direct Q&A with an
  optional screenshot attachment.

All three hit the same endpoint: `POST /api/completion` on the worker.

### 5.2 Request shape

```jsonc
POST /api/completion
Content-Type: application/json
x-session-id: <jwt>

{
  "prompt": "…",                 // user question or transcript slice
  "context": "…",                // interview context preset
  "mode": "copilot" | "summarizer" | "direct",
  "image": "data:image/png;base64,AAA…"    // optional, Ask AI only
}
```

### 5.3 Prompt construction

```ts
// realtime-worker-api/src/index.ts
function buildPrompt(bg: string | undefined, conversation: string) {
  return `You are acting AS the candidate in a live job interview...
  [interview context]: ${bg}
  [conversation transcript]: ${conversation}
  Answer the most recent question briefly and in first person.`;
}
```

A different builder (`buildSummarizerPrompt`) handles summarizer mode.

### 5.4 Vision — how images get attached

User side (Ask AI):

1. User presses `⌘⇧1` (global shortcut registered in `electron/main.ts`).
2. Main process captures a thumbnail via `desktopCapturer.getSources()` with
   a resolution matching the primary display, then converts it to a
   `data:image/png;base64,…` URL and returns it through IPC.
3. `QuestionAssistant.tsx` stores the data URL in local state, shows a
   thumbnail chip, and includes `image` in the next request body.

Worker side:

```ts
function parseImageDataUrl(input) {
  // Validates MIME (image/png, image/jpeg, image/webp),
  // strips the "data:*;base64," prefix, enforces a max size,
  // returns { mimeType, data } or null.
}
```

Then for **Gemini** we embed it as `inlineData`:

```json
{ "contents": [{ "role": "user", "parts": [
  { "inlineData": { "mimeType": "image/png", "data": "<base64>" } },
  { "text": "<prompt>" }
]}]}
```

For **OpenAI-compatible** endpoints we emit the standard chat-completions
multimodal format:

```json
{ "messages": [{ "role": "user", "content": [
  { "type": "image_url", "image_url": { "url": "data:image/png;base64,..." } },
  { "type": "text", "text": "<prompt>" }
]}]}
```

The image is placed **before** the text because Google's cookbook says
vision accuracy is higher that way.

### 5.5 Streaming to the UI

The worker calls the provider's SSE endpoint (`:streamGenerateContent` for
Gemini, `stream: true` for OpenAI-compatible) and forwards chunks to the
client as plain SSE:

```
data: {"delta":"Sure, here's how I'd "}

data: {"delta":"answer that question: "}
…
data: [DONE]
```

The renderer consumes it with a plain `ReadableStream` reader and calls
`setAnswer((prev) => prev + delta)` on every chunk, which is what drives the
"tokens streaming in" feel in Ask AI.

---

## 6. The worker API (`realtime-worker-api/`)

A Cloudflare Worker is one TypeScript file deployed worldwide on the edge.
Zero-cold-start, per-request isolates.

### 6.1 Routes

| Route | Purpose |
|---|---|
| `POST /api/auth/*` | Better Auth: signup, signin, social, sessions |
| `GET  /api/deepgram-key` | Issues ephemeral 10-min Deepgram keys |
| `POST /api/completion` | Streams AI answer (Gemini / OpenAI-compatible, optional vision) |
| `POST /api/export` | Builds markdown / HTML export of the current session |
| `GET/POST /api/config` | User-scoped config (custom model, keys, etc.) |
| `GET  /api/admin/*` | Admin dashboard data (audit logs, users, bans) |

### 6.2 Data model (Cloudflare D1 / SQLite)

Tables set up by Drizzle ORM migrations:

- `user` — id, email, passwordHash, emailVerified, banned, role, createdAt
- `session` — jwt-backed sessions with expiration
- `account` — OAuth / social provider links
- `user_config` — KV-style per-user config (gemini_model, custom_base_url,
  custom_api_key, deepgram_key override, …)
- `audit_log` — admin action trail
- `security_event` — rate-limit hits, failed logins, suspicious events
- `rate_limit_window` — tracks login/signup attempts per IP per hour

### 6.3 Authentication

Uses **Better Auth** with:

- Email/password (argon2-hashed via `lib/crypto.ts`)
- Disposable-email domain rejection (`config.json` carries the blocklist)
- Rate limiting: `maxLoginAttemptsPerHour=10`, `maxSignupsPerHour=5`
- Admin role gated by `ADMIN_EMAIL` environment variable

### 6.4 Security hardening implemented in the worker

- Strict CORS allowlist (`TRUSTED_ORIGINS`) — only production + localhost
  origins pass.
- Constant-time token comparison via `hmac.compare_digest`-equivalent.
- Image validation: MIME-allowlist, max size, base64 format check.
- No logging of prompts, API keys, or PII (per repo rules).
- `activity` writes throttled to `ACTIVITY_UPDATE_INTERVAL_MS = 5min` to
  avoid DB churn.
- All network calls use HTTPS; worker never disables SSL validation.

---

## 7. Desktop ↔ worker trust flow

```
┌────────────┐      signup / login                 ┌───────────────┐
│ desktop    │─────────────────────────────────►   │ worker /auth  │
│ app        │◄─── set-cookie session JWT ─────    └───────────────┘
└────────────┘
      │ x-session-id: <jwt>
      ▼
┌─────────────────────────────────────────────────────────────────┐
│ GET /api/deepgram-key          → ephemeral 10-min Deepgram key  │
│ POST /api/completion { prompt, mode, image? }  → SSE answer     │
│ POST /api/export { format, …}  → markdown/html file             │
└─────────────────────────────────────────────────────────────────┘
```

- The desktop app never talks to Deepgram or Gemini with a long-lived key.
- Model API keys are held by the worker (or by the user in their own
  `user_config` row if they use a custom model).

---

## 8. Undetectability in screen shares

Three layers keep the window off screen shares:

1. **`setContentProtection(true)`** on the main `BrowserWindow` — OS-level
   flag that screen-capture APIs honor. On macOS this uses the same
   `NSWindowSharingNone` that DRM apps use; on Windows it flags the window
   with `WDA_EXCLUDEFROMCAPTURE` on Windows 10 2004+.
2. **`setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })`** —
   keeps the window visible over full-screen Meet/Zoom/Teams spaces while
   still being content-protected.
3. **`setSharingType("main-thread")`** on macOS to avoid compositor paths
   that could bypass the protection.

Content protection is toggled per-window on launch and re-applied whenever
the window is shown after being hidden.

---

## 9. Global hotkeys & IPC surface

Registered in `electron/main.ts` on `whenReady()`:

- `⌘⇧1` (mac) / `Ctrl+Shift+1` (win) — capture screen, switch to Ask AI,
  dispatch `ask-ai:attach-screenshot` custom event with the data URL.

IPC channels exposed via `electron/preload.ts` → `window.electronAPI`:

| Channel | Purpose |
|---|---|
| `screen:get-access` | Current macOS Screen Recording status |
| `screen:open-settings` | Opens System Settings → Privacy & Security |
| `screen:trigger-prompt` | Forces the first-time OS permission dialog |
| `screen:capture` | Silent full-screen thumbnail → data URL |
| `screen:capture-and-ask` | Fires from the hotkey, consumed by renderer |
| `app-quit` | Graceful shutdown |
| `app-relaunch` | `app.relaunch(); app.exit(0)` — used after granting TCC |
| `sync-context` | Sync interview context across windows (unused today) |

All channels are whitelisted in `preload.ts` via `contextBridge`; the
renderer never gets direct Node access.

---

## 10. Frontend structure

- **`components/main.tsx`** — tab router between Copilot / Ask AI / Presets,
  listens for the `ask-ai:attach-screenshot` event, owns the global
  onboarding modal.
- **`components/recorder.tsx`** — recording controls, talks to
  `useDeepgramTranscriber`, renders transcripts.
- **`components/copilot.tsx`** — Copilot + Summarizer modes, streams from
  `/api/completion`.
- **`components/QuestionAssistant.tsx`** — Ask AI with sticky composer,
  scrollable answer area, animated loader, screenshot attachment.
- **`components/ScreenRecordingOnboard.tsx`** — permission polling + modal
  + banner + relaunch CTA.
- **`components/TranscriptionDisplay.tsx`** & `TranscriptionLine.tsx` —
  rendering finalized + interim transcripts.
- **`components/auth/`** — sign in / sign up flows, backed by Better Auth
  client.
- **`components/admin/`** — admin dashboard (audit logs, users, bans).

Styling: Tailwind CSS + Shadcn/UI components under `components/ui/`.

---

## 11. Build + release pipeline

### 11.1 Local dev

```bash
bun install
bun run electron:dev     # Next.js dev server + Electron hot reload
```

`scripts/build-electron.js` compiles `electron/main.ts` and
`electron/preload.ts` using the locally-resolved TypeScript binary. Using
`require.resolve("typescript/bin/tsc")` avoids Windows CI accidentally
installing the unrelated `tsc@2.0.4` stub package.

### 11.2 Packaging

`bun run electron:build` runs:

1. `bun run build:electron` → emits `electron/main.js`, `electron/preload.js`.
2. `next build` → static export into `out/`.
3. `electron-builder` → reads the `build` block in `package.json` and
   produces installers into `dist/`.

Targets defined in `package.json`:

| Platform | Targets |
|---|---|
| macOS | `dmg`, `zip` (Apple Silicon only for now) |
| Windows | `nsis` installer, `portable` |
| Linux | `AppImage`, `deb` |

Artifact names follow `${productName}-${version}-${os}-${arch}.${ext}`.

### 11.3 Windows icon

electron-builder requires `.ico` files to contain a 256×256 entry.
`scripts/gen-win-icon.js` uses `sharp` + `png-to-ico` to generate a
multi-size icon from `public/icons/android-chrome-512x512.png`.

### 11.4 CI — `.github/workflows/release.yml`

Triggered on:

- Push of any tag matching `v*`
- Manual `workflow_dispatch` with a tag name

Jobs:

1. **`build`** (matrix: `macos-14` + `windows-latest`) — installs Bun,
   compiles, runs `electron-builder`, uploads artifacts.
2. **`release`** — downloads all artifacts, creates/updates a GitHub Release
   with `softprops/action-gh-release@v2`, auto-generated changelog, all
   DMGs/ZIPs/EXEs attached. Beta builds are marked as latest (only alpha/rc
   are prereleases).
3. **`tap`** — regenerates `homebrew/Casks/realtime-interview-copilot.rb`
   with the new version + SHA256 via `scripts/update-homebrew-cask.js`, and
   if `HOMEBREW_TAP_TOKEN` is set, pushes the updated cask to
   `innovatorved/homebrew-tap`.

Skip logic: the `tap` job gracefully no-ops when the token isn't
configured, so it never blocks a release.

---

## 12. Distribution

### 12.1 macOS

- **`dmg`** — ad-hoc signed. Users either Homebrew-install (recommended) or
  right-click → Open on first launch.
- **Homebrew cask** (`innovatorved/tap`):

  ```bash
  brew tap innovatorved/tap
  brew install --cask realtime-interview-copilot
  ```

  The cask's `postflight` strips the quarantine attribute automatically:

  ```ruby
  postflight do
    system_command "/usr/bin/xattr",
                   args: ["-cr", "#{appdir}/Realtime Interview Copilot Beta.app"]
  end
  ```

  So no Gatekeeper warning.

- Notarization requires a paid Apple Developer ID ($99/yr) — currently
  skipped for the beta; the project will add it once it stabilizes.

### 12.2 Windows

- NSIS `.exe` installer, currently unsigned.
- Long-term plan: join the **SignPath Foundation** OSS code signing
  program (free for qualifying projects) — application materials are
  already prepared in `PRIVACY.md` + the SignPath attribution line in the
  README and release notes.
- Until signed, users bypass SmartScreen via **More info → Run anyway**.

---

## 13. Configuration & secrets

Nothing sensitive ships in the binary. At runtime the app reads:

- User credentials via the authenticated session cookie.
- Per-user config (`gemini_model`, `custom_base_url`, `custom_api_key`,
  `deepgram_key` override) from the worker.

Worker secrets live in Cloudflare environment variables (`wrangler.toml`
bindings + Cloudflare secrets):

- `GEMINI_API_KEY`
- `DEEPGRAM_API_KEY` (used to mint ephemeral tokens)
- `DEEPGRAM_PROJECT_ID`
- `JWT_SECRET`, `POSTHOG_API_KEY`, etc.
- `ADMIN_EMAIL` — unlocks `/api/admin/*`

---

## 14. Observability

- **PostHog** (optional): `realtime-worker-api/src/posthog.ts` fires
  server-side events for completion usage, admin actions, and security
  events. Fully removable by unsetting the env var.
- **Cloudflare analytics**: included by default for every request.
- **Client-side**: `posthog.capture("screen_attached_to_question")` and a
  handful of similar events; no session replay, no PII capture.

---

## 15. Security & privacy posture

| Concern | Mitigation |
|---|---|
| Leaked long-lived Deepgram key | Never ships — worker mints 10-min scoped keys |
| Leaked model API key | Lives in Cloudflare secrets, never reaches the client |
| SQL injection | Drizzle ORM parameterizes all queries |
| CSRF | Session cookie with `SameSite=Lax`; requests require origin check |
| CORS | Explicit `TRUSTED_ORIGINS` allowlist |
| Screen share leaks | `setContentProtection` + `setSharingType` |
| Supply chain | Bun frozen lockfile; `trustedDependencies` pinned |
| Image upload abuse | MIME allowlist + max size in `parseImageDataUrl` |
| Rate-limit abuse | Per-IP signup/login counters in D1 |
| User data | Stored locally + in the user's own D1 row; see `PRIVACY.md` |

The full privacy breakdown — what leaves your machine, what each third
party does, and how to opt out — lives in [`PRIVACY.md`](./PRIVACY.md).

---

## 16. Repository layout

```
realtime-interview-copilot/
├── electron/                 Main + preload (typescript → js)
│   ├── main.ts               Window, IPC, loopback audio handler
│   └── preload.ts            contextBridge surface (window.electronAPI)
├── components/               React UI
│   ├── main.tsx              Tab router + onboarding
│   ├── recorder.tsx          Audio capture + transcription
│   ├── copilot.tsx           Copilot / Summarizer
│   ├── QuestionAssistant.tsx Ask AI + vision
│   ├── ScreenRecordingOnboard.tsx
│   ├── TranscriptionDisplay.tsx
│   └── ui/                   Shadcn primitives
├── hooks/
│   ├── useDeepgramTranscriber.ts   WS streaming + token fetch
│   ├── useExport.ts                Export session as md/html
│   └── ...
├── lib/                      Shared helpers (constants, types, auth client)
├── realtime-worker-api/      Cloudflare Worker backend
│   └── src/
│       ├── index.ts          Router + handlers
│       ├── auth.ts           Better Auth setup
│       ├── crypto.ts         Argon2 + constant-time helpers
│       ├── db/               Drizzle schema + migrations
│       ├── plugins/
│       └── posthog.ts
├── homebrew/Casks/           Cask definition (synced to tap repo by CI)
├── scripts/
│   ├── build-electron.js     Cross-platform TypeScript build
│   ├── gen-win-icon.js       256x256 .ico generator
│   └── update-homebrew-cask.js
├── .github/workflows/
│   └── release.yml           Build mac + win, release, push cask
├── public/icons/             App icons for mac/win/linux
├── package.json              App version, electron-builder config
├── README.md                 Short download + dev guide
├── PRIVACY.md                Privacy policy for SignPath + users
├── ARCHITECTURE.md           This file
├── CONTRIBUTING.md
└── LICENSE
```

---

## 17. End-to-end trace: one interview question

To cement the mental model, here's the life of one interview question,
second by second:

```
t = 0.000 s  Interviewer says "tell me about a hard bug you fixed"
t = 0.001 s  macOS routes audio to speakers
             → ScreenCaptureKit audio tap captures it into Chromium
t = 0.000 s  MediaRecorder accumulates 250 ms of Opus
t = 0.250 s  dataavailable fires with a ~3 KB Blob
             socket.send(blob)  → Deepgram over WSS
t = 0.290 s  Deepgram begins transcribing
t = 0.400 s  onmessage: is_final=false, transcript="tell me"
             → interimTranscript = "tell me"  (rendered in grey)
t = 0.650 s  onmessage: is_final=false, transcript="tell me about a hard"
t = 1.100 s  onmessage: is_final=false, transcript="tell me about a hard bug..."
t = 1.800 s  Interviewer stops speaking
t = 2.250 s  Deepgram endpointing (450 ms) fires →
             onmessage: is_final=true, transcript="Tell me about a hard bug you fixed."
             → transcripts.push({ transcript, speaker: "Speaker 0", timestamp })
             → Copilot component sees a new final line →
               POST /api/completion { prompt, context, mode: "copilot" }
t = 2.450 s  Worker resolves config, calls Gemini streamGenerateContent
t = 2.600 s  First SSE chunk arrives →
             "Sure, one of the toughest bugs I fixed..."
t = 2.700 s  Subsequent chunks append to answer; UI streams
t = 6.800 s  Gemini sends [DONE]; final answer shown
```

From mouth to on-screen answer: ~3 seconds. ~4–5 s for a longer answer.

---

## 18. Further reading

- `README.md` — install & quickstart
- `PRIVACY.md` — data handling
- `CONTRIBUTING.md` — dev setup & contribution guide
- Release notes: [GitHub Releases](https://github.com/innovatorved/realtime-interview-copilot/releases)
