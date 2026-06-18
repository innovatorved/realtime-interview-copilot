# Realtime Interview Copilot Architecture

This document explains how the desktop app, worker API, and database fit together.
It focuses on runtime boundaries, data flow, security, build, and release behavior.

## 1. System overview

Realtime Interview Copilot is a desktop assistant for live interviews. It captures system audio, transcribes speech in real time, supports Ask AI with screenshots, and keeps the app protected from normal screen sharing paths.

The system has three main parts:

| Part | Runtime | Responsibility |
|---|---|---|
| Desktop app | Electron 41, Next.js 16, React 19 | Window management, audio capture, transcription UI, screenshots, hotkeys, and worker communication |
| Worker API | Cloudflare Workers | Authentication, token minting, completions, notes, presets, sessions, support, announcements, and usage tracking |
| Database | Cloudflare D1 with Drizzle ORM | Users, sessions, config, notes, presets, support threads, announcements, audit data, and usage records |

The desktop app does not hold long-lived model or Deepgram secrets. Those stay in the worker.

## 2. Desktop runtime

### 2.1 Process split

The Electron app follows the normal main, preload, and renderer separation:

- `electron/main.ts` owns the `BrowserWindow`, security setup, hotkeys, and IPC handlers.
- `electron/preload.ts` exposes a limited `window.electronAPI` bridge through `contextBridge`.
- The renderer is the Next.js app in `app/` and `components/`.

The window is frameless, transparent, always on top, sandboxed, and isolated from Node in the renderer. The UI only gets the capabilities exported by preload.

### 2.2 UI composition

`components/main.tsx` orchestrates the main app shell:

- It switches between Copilot, Ask AI, and Presets.
- It manages compact mode and click-through overlay behavior.
- It wires in saved notes, preset loading, and export.
- It listens for the global capture-and-ask shortcut and opens Ask AI with the screenshot attached.

Important UI surfaces include:

- `components/copilot.tsx` for live interview copilot and summarizer flows.
- `components/QuestionAssistant.tsx` for Ask AI with screenshot support.
- `components/recorder.tsx` for live audio capture and transcription controls.
- `components/TranscriptionContext.tsx` and `components/TranscriptionDisplay.tsx` for transcript state and rendering.
- `components/CompactCopilot.tsx` for compact overlay mode.
- `components/InterviewPresets.tsx`, `hooks/usePresets.ts`, `hooks/useNotes.ts`, and `hooks/useExport.ts` for saved workflows.

### 2.3 Compact overlay mode

Compact mode (`components/CompactCopilot.tsx`, toggled from the Title bar) resizes the Electron window to a thin toolbar strip (expanding when an answer or drawer is open). Most of the window is transparent so the user can see and click through to apps behind the interview.

Click-through is implemented in `hooks/useClickThrough.ts`:

- The main process calls `setIgnoreMouseEvents(true, { forward: true })` so mousemove still reaches the renderer.
- Interactive regions (`.titlebar-chrome`, `.app-toolbar`, `[data-clickable]`, form controls, buttons) disable ignore so clicks and window drag work on the chrome.
- `pointerdown` syncs ignore state before drag so the title bar can be grabbed without a prior mousemove.
- Entering an interactive region calls `window-focus` IPC so keyboard shortcuts work immediately after hover.

Compact-only keyboard handling lives in `CompactCopilot.tsx` (Mod+Enter generate, Alt+A Ask drawer) with shared Esc / Mod+Shift+N from `components/ask/useAskKeyboard.ts`. Tab shortcuts in `TabContext.tsx` are disabled while compact mode is active so Alt+A does not also switch hidden tabs.

### 2.4 Backdrop opacity

The Title bar **− / +** control adjusts `backdropOpacity` in `components/AppBackdropContext.tsx` (persisted in `localStorage` on Electron). The value is published as CSS variable `--app-backdrop-opacity` on `document.documentElement`.

| Surface | Full mode | Compact mode |
|---------|-----------|--------------|
| Full-window fill | `AppBackdrop` rgba layer follows slider | No full-window layer |
| Title bar / toolbars | `.titlebar-chrome`, `.app-toolbar` (minimum opacity floor so chrome stays grabbable) | Same — only navbar strip dims |
| Content cards | `.glass-card` mix scales with slider | Output area stays transparent; text uses light inline halos only |

### 2.5 Auto-update

`electron/updater.ts` wraps `electron-updater` for packaged builds. The Title bar download icon triggers `updaterCheck`; status events flow to the renderer via preload. Release artifacts include `latest-mac.yml` / `latest.yml` for the updater. Homebrew cask installs are expected to use `brew upgrade --cask` instead of the in-app updater.

## 3. Security model

### 3.1 Window hardening

`electron/main.ts` hardens the window and limits leakage:

- `contextIsolation: true`, `sandbox: true`, and `nodeIntegration: false` keep Node out of the renderer.
- `setContentProtection(true)` reduces capture through OS screen recording paths.
- On macOS, `setSharingType("none")` and `setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })` keep the window usable while limiting sharing exposure.
- Navigation is locked down so only trusted origins can load in the window, and external links open in the default browser.

### 3.2 CSP and origin checks

The main process installs a strict content security policy and origin header handling before loading the app. The worker also enforces trusted origins so desktop and browser requests agree on what is allowed.

### 3.3 Preload API

`electron/preload.ts` exposes only the capabilities the UI needs:

- Window controls such as minimize, maximize, close, always-on-top, resize, ignore mouse events, and focus.
- App lifecycle actions such as quit, relaunch, and auto-update check.
- Screen capture helpers such as access checks, OS settings, the macOS permission prompt, screenshot capture, and capture-and-ask events.
- Platform flags such as `platform`, `isElectron`, and `supportsSystemAudio`.

No direct filesystem, shell, or arbitrary IPC access is exposed to the renderer.

## 4. Audio and screenshot capture

### 4.1 System audio without virtual drivers

The app captures speaker output using Electron display-media support and native OS loopback audio instead of third-party virtual audio drivers.

`electron/security/permissions.ts` installs the capture handlers:

- `setPermissionRequestHandler` grants `media`, `display-capture`, and `notifications` only for trusted renderer origins.
- `setPermissionCheckHandler` lets Chromium complete synchronous media checks so native macOS permission flows are reached correctly.
- `setDisplayMediaRequestHandler` returns the primary screen with `audio: "loopback"` so Chromium receives system audio directly.

This keeps the app off tools like BlackHole, VB-Audio, and Voicemeeter.

### 4.2 macOS permissions

macOS requires separate permissions for screen capture and microphone capture.

Screen recording uses a dedicated onboarding flow:

- `components/ScreenRecordingOnboard.tsx` polls permission state.
- In **full mode**, a modal explains the one-time setup; **Later** collapses to a bottom pill.
- In **compact mode**, a non-blocking **Screen access** chip on the right opens System Settings so the overlay stays usable without granting permission first.
- `screen:trigger-prompt` in `electron/ipc/screen.ts` triggers the native prompt by calling `desktopCapturer.getSources()`.
- `screen:open-settings` opens the correct macOS settings page.
- After permission changes, the app relaunches so the OS can apply the updated TCC state cleanly.

Microphone access for Ask AI is handled separately:

- `electron/main.ts` checks `systemPreferences.getMediaAccessStatus("microphone")` during startup.
- If the status is `not-determined`, the app waits for `systemPreferences.askForMediaAccess("microphone")` before creating the renderer window.
- If the status is `denied` or `restricted`, the app opens the macOS microphone privacy pane.
- Packaged macOS builds include `NSMicrophoneUsageDescription` in `package.json` and the `com.apple.security.device.audio-input` entitlement in `build/entitlements.mac.plist` and `build/entitlements.mac.inherit.plist`.

### 4.3 Screenshot capture

`electron/ipc/screen.ts` also performs one-shot screenshot capture:

- It captures the primary display with `desktopCapturer`.
- It downsizes large images to keep request payloads manageable.
- It returns a PNG data URL to the renderer.

The global hotkey `CommandOrControl+Shift+1` is registered in the main process and sends `screen:capture-and-ask` to the renderer. The Ask AI UI attaches the screenshot to the next request.

## 5. Transcription pipeline

### 5.1 Capture and chunking

The renderer uses `navigator.mediaDevices.getDisplayMedia({ video: true, audio: true })`, stops the video track, and keeps the audio track for transcription.

The audio stream is passed to `MediaRecorder` with a 250 ms timeslice so the app emits small chunks at a steady cadence.

### 5.2 Deepgram token minting

The worker mints short-lived Deepgram keys on demand:

- `GET /api/deepgram` and `GET /api/deepgram/ask` are the live routes, with legacy aliases supported.
- The worker checks authentication, applies rate limits, and can bind the token to a live session.
- The Deepgram project key never reaches the client.
- The token TTL is 60 seconds in the current implementation.

The Ask AI mic-only flow uses its own minting route so it can be tracked separately from the main transcription path.

### 5.3 Deepgram streaming

The live transcription client opens a WebSocket to Deepgram with `model=nova-3`, diarization, multi-language detection, and endpointing enabled. Interim results drive the live gray line, and final results are appended to the transcript list.

Ask AI microphone dictation uses `hooks/useAskMic.ts`, mints a token from `/api/deepgram/ask`, opens a short-lived Deepgram WebSocket, and streams microphone chunks from `MediaRecorder`.

`hooks/useMicPushToTalk.ts` owns the Space and Ctrl+Space push-to-talk behavior, tap toggle behavior, and release timing guard so a slow key or slow socket handshake does not cancel recording early.

### 5.4 Session tracking

The worker exposes session lifecycle endpoints:

- `POST /api/sessions/start`
- `POST /api/sessions/end`
- `POST /api/sessions/end-all`

These endpoints help recover from hard-killed processes and support usage and admin views.

## 6. Ask AI and completions

### 6.1 User-facing modes

The app uses the same worker completion endpoint for multiple workflows:

- Copilot answers the latest interview question from the live transcript.
- Summarizer condenses the conversation so far.
- Ask AI handles direct questions, with or without an attached screenshot.

The main endpoint is `POST /api/completion`.

### 6.2 Request validation

The worker validates:

- Prompt and background text length.
- Message count limits.
- Image payload shape.
- Custom base URL safety for OpenAI-compatible endpoints.

Vision payloads are limited to accepted image data URLs. The client helper in `lib/vision-screenshot.ts` mirrors the worker’s accepted MIME types so invalid captures are rejected early.

### 6.3 Prompt construction

The worker builds Copilot and Summarizer prompts server-side in `realtime-worker-api/src/lib/prompt.ts` so transcript logic and final answer style stay separate.

Ask AI also carries a front-end background instruction, `ASK_AI_BACKGROUND`, in both `components/QuestionAssistant.tsx` and `components/CompactCopilot.tsx`. The client sends that background with the first turn through `hooks/useAskChat.ts`; the worker applies it without repeating it on every turn. Screenshot-only Ask AI requests use `VISION_FALLBACK_PROMPT` from `lib/vision-screenshot.ts`.

### 6.4 Provider abstraction

The completion route supports two provider paths:

- Gemini through the Cloudflare and Google path, which is the default.
- OpenAI-compatible custom endpoints for users who bring their own backend.

`realtime-worker-api/src/routes/completion-gemini.ts` and `realtime-worker-api/src/routes/completion-openai.ts` handle provider-specific wire formats. `realtime-worker-api/src/routes/completion.ts` owns validation, rate limiting, usage tracking, and the SSE contract.

### 6.5 SSE response format

The worker streams plain SSE frames containing JSON payloads:

- `{ "text": "..." }` for generated text.
- `{ "error": "..." }` for failures.
- `[DONE]` as the terminator.

The client parses these streams through `lib/sse.ts`, which preserves the same carry-buffer behavior across the UI surfaces.

### 6.6 Screenshot attachment flow

When the user presses the hotkey:

1. The main process captures a screenshot.
2. The renderer receives it through `screen:capture-and-ask`.
3. `QuestionAssistant.tsx` stores the data URL and attaches it to the next completion request.
4. The worker converts it to the provider-specific multimodal format.

For Gemini, the image becomes `inlineData`. For OpenAI-compatible endpoints, the worker emits a multimodal `messages` array with `image_url` entries.

## 7. Worker API

`realtime-worker-api/src/index.ts` is the request dispatcher. It routes traffic to specialized handlers and applies shared cross-cutting concerns such as CORS and origin gating.

### 7.1 Public routes

| Route | Purpose |
|---|---|
| `POST /api/auth/*` | Better Auth signup, signin, and session handling |
| `GET /api/deepgram` | Mint short-lived Deepgram keys for live transcription |
| `GET /api/deepgram/ask` | Mint short-lived Deepgram keys for Ask AI mic capture |
| `POST /api/completion` | Stream Copilot, Summarizer, and Ask AI completions |
| `POST /api/export` | Export session data as markdown or HTML |
| `GET /api/notes`, `POST /api/notes`, `DELETE /api/notes/:id` | Saved interview notes |
| `GET /api/presets` | Interview preset templates and background context |
| `GET /api/usage/me` | User usage summary |
| `POST /api/sessions/start`, `POST /api/sessions/end`, `POST /api/sessions/end-all` | Session lifecycle management |
| `POST /api/events/track` | Analytics and product events |
| `GET /api/support/messages`, `POST /api/support/messages`, `POST /api/support/messages/read` | Support threads |
| `GET /api/announcements/active`, `POST /api/announcements/:id/dismiss`, `POST /api/announcements/:id/ack` | In-app announcements |

Some routes also keep backward-compatible aliases without the `/api` prefix.

### 7.2 Authentication

`realtime-worker-api/src/auth.ts` uses Better Auth with a Drizzle SQLite adapter.

Key points:

- Email and password authentication are enabled.
- Passwords are hashed and verified in worker code.
- Trusted browser origins are explicitly allowlisted.
- Cookies use `SameSite=None` and `Secure` because the desktop app and worker are not same-site in the normal browser sense.
- The admin plugin controls approval, banning, and administrative configuration.
- Disposable-email blocking and rate limits are enforced at the auth layer.

### 7.3 Config and secrets

Runtime config comes from Cloudflare bindings and per-user configuration stored in D1. The worker can read:

- Gemini model and key configuration.
- Deepgram project key for minting short-lived tokens.
- Custom model base URL and API key.
- Admin email list and auth secret material.

The desktop app only receives the minimal session-scoped values it needs.

## 8. Data model

The database lives in Cloudflare D1 and is managed with Drizzle migrations. The schema is grouped around a few functional areas:

- Users, sessions, and account links.
- Per-user config and feature settings.
- Live interview sessions and Deepgram key bindings.
- Saved notes and interview presets.
- Support threads and announcements.
- Usage, audit, and security events.

Operational data stays in the worker database rather than inside the desktop binary.

## 9. Security and privacy

The security model is built around explicit trust boundaries and short-lived credentials.

### 9.1 Main defenses

- System audio is captured with OS-native loopback support, not a third-party driver.
- The desktop window is content-protected and difficult to capture.
- Renderer access is limited to a preload-defined API.
- The worker enforces trusted origins before accepting state-changing requests.
- Rate limiting is applied to auth, Deepgram key minting, and completions.
- Model API keys and Deepgram project keys never ship in the desktop app.
- Image input is restricted to validated data URLs and size bounds.
- Network calls use HTTPS.

### 9.2 Operational privacy

The app should be conservative about logging. Prompt text, API keys, and other sensitive user data should not be logged unless a specific debug path requires it. `PRIVACY.md` is the source of truth for user-facing data handling.

## 10. Build and packaging

### 10.1 Local development

The main workflows are driven by `package.json`:

- `bun run electron:dev` builds the Electron TypeScript files, starts Next.js, and launches Electron against the dev server.
- `bun run electron:debug` does the same but opens DevTools automatically.
- `bun run electron:build` compiles the Electron scripts, builds the Next.js app, and hands off to `electron-builder`.

### 10.2 Electron compilation

`scripts/build-electron.js` resolves the local TypeScript compiler with `require.resolve("typescript/bin/tsc")` and compiles `electron/main.ts` and `electron/preload.ts` into `electron/`. That keeps builds consistent across platforms without depending on an external `tsc` binary.

### 10.3 Packaging targets

The app is configured to produce:

- macOS: `dmg`, `zip`
- Windows: `nsis`
- Linux: `AppImage`, `deb`

The release pipeline currently publishes macOS and Windows artifacts. Linux packaging is present but not part of the default release matrix.

macOS packaging uses Electron Builder entitlements from `build/entitlements.mac.plist` and `build/entitlements.mac.inherit.plist`. Those entitlements include `com.apple.security.device.audio-input`, which is required for packaged builds to appear in macOS microphone privacy settings.

### 10.4 Homebrew cask

`scripts/update-homebrew-cask.js` regenerates the Homebrew cask version and SHA256 from the release artifacts. The cask update is part of the release flow so macOS users can install with `brew install --cask realtime-interview-copilot` and update with `brew upgrade --cask realtime-interview-copilot` after each tagged release.

## 11. Release pipeline

`.github/workflows/release.yml` drives releases.

### 11.1 Triggers

- Pushes of tags matching `v*`.
- Manual `workflow_dispatch` with a tag name.

### 11.2 Build job

The build job runs on macOS and Windows:

- Installs Bun and Node 22.
- Runs `bun install --frozen-lockfile`.
- Trusts only the native packages that need postinstall scripts.
- Builds Electron and Next.js.
- Packages the app with `electron-builder`.
- Verifies the packaged macOS app contains `com.apple.security.device.audio-input` and `NSMicrophoneUsageDescription` before uploading artifacts.
- Uploads DMG, ZIP, EXE, and blockmap artifacts.

### 11.3 Release job

The release job downloads the build artifacts and publishes a GitHub Release with generated release notes.

### 11.4 Tap update job

The tap job regenerates the Homebrew cask and, if the Homebrew tap token is present, pushes the updated cask to the external tap repository. If the token is missing, the job skips cleanly.

## 12. Repository layout

| Path | Purpose |
|---|---|
| `app/` | Next.js app routes and global styles |
| `components/` | Desktop UI, onboarding, assistant surfaces, shared components |
| `electron/` | Electron main process, preload, IPC, permissions, security |
| `build/` | Electron Builder resources such as macOS entitlement plists |
| `hooks/` | Frontend hooks for notes, presets, capture, export, mic, and window behavior |
| `lib/` | Shared helpers, SSE parsing, vision validation, constants, auth client |
| `realtime-worker-api/` | Cloudflare Worker backend and its routes, middleware, schema, and config |
| `public/` | Icons and static assets |
| `scripts/` | Build and release helpers |
| `.github/workflows/` | CI and release automation |

## 13. End-to-end flow

This is the path a single interview question takes through the system:

1. The interviewer speaks in Zoom, Meet, Teams, or another call app.
2. The Electron main process routes system audio into Chromium through loopback capture.
3. The renderer chunks that audio with `MediaRecorder` and sends it to Deepgram.
4. Deepgram returns interim and final transcript results.
5. The UI updates the live transcript and, in Copilot mode, sends the latest question context to the worker.
6. The worker validates the request, resolves the user config, and streams a completion from Gemini or a custom OpenAI-compatible model.
7. The renderer consumes the SSE stream and paints the answer as it arrives.
8. If the user uses the screenshot hotkey, the desktop app captures the screen, attaches the image, and repeats the completion flow with multimodal input.

From the user's point of view, the whole loop is one assistant experience. Under the hood, it is a chain of tightly scoped components with explicit trust boundaries.

## 14. Reference files

- `electron/main.ts`
- `electron/preload.ts`
- `electron/ipc/screen.ts`
- `electron/security/permissions.ts`
- `build/entitlements.mac.plist`
- `build/entitlements.mac.inherit.plist`
- `components/main.tsx`
- `components/copilot.tsx`
- `components/QuestionAssistant.tsx`
- `components/CompactCopilot.tsx`
- `components/ScreenRecordingOnboard.tsx`
- `components/AppBackdropContext.tsx`
- `hooks/useClickThrough.ts`
- `hooks/useAskMic.ts`
- `hooks/useMicPushToTalk.ts`
- `electron/updater.ts`
- `lib/sse.ts`
- `lib/vision-screenshot.ts`
- `realtime-worker-api/src/index.ts`
- `realtime-worker-api/src/auth.ts`
- `realtime-worker-api/src/routes/completion.ts`
- `realtime-worker-api/src/routes/deepgram.ts`
- `.github/workflows/release.yml`
- `scripts/build-electron.js`
- `scripts/update-homebrew-cask.js`
