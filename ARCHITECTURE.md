# Realtime Interview Copilot - Architecture

This document is the system-level map for the current codebase. It covers the desktop app, the worker API, data flow, security boundaries, build pipeline, and release process.

## 1. Product overview

Realtime Interview Copilot is a desktop assistant for live interviews. It captures system audio from the user's machine, transcribes it in real time, generates interview answers, supports screenshot-based Ask AI, and keeps the window hidden from screen sharing.

The product is split into three major pieces:

| Unit | Runtime | Responsibility |
|---|---|---|
| Desktop app | Electron 41 + Next.js 16 + React 19 | Capture audio, render the UI, expose screenshot and window controls, talk to the worker |
| Worker API | Cloudflare Workers | Auth, token minting, completions, notes, presets, sessions, support, announcements, usage tracking |
| Database | Cloudflare D1 + Drizzle ORM | Users, sessions, config, notes, presets, support threads, announcements, audit and usage records |

The desktop app never talks directly to Deepgram or model providers with long-lived secrets. Those secrets live in the worker.

## 2. Runtime architecture

### 2.1 Desktop process split

The Electron app uses the standard main / preload / renderer separation:

- `electron/main.ts` owns the `BrowserWindow`, security hardening, hotkeys, and IPC registration.
- `electron/preload.ts` exposes a narrow `window.electronAPI` surface via `contextBridge`.
- The renderer is the Next.js app under `app/` and `components/`.

The main window is frameless, transparent, always on top, sandboxed, and isolated from Node in the renderer. The renderer only gets access to capabilities explicitly exported through preload.

### 2.2 App shell and UI composition

The main page is orchestrated by `components/main.tsx`:

- It switches between Copilot, Ask AI, and Presets.
- It drives compact mode and the click-through overlay behavior.
- It wires in saved notes, preset loading, and export.
- It listens for the global capture-and-ask shortcut and opens Ask AI with the screenshot attached.

The important front-end pieces are:

- `components/copilot.tsx` - live interview copilot and summarizer flows.
- `components/QuestionAssistant.tsx` - Ask AI with screenshot support.
- `components/recorder.tsx` - live audio capture and transcription controls.
- `components/TranscriptionContext.tsx` and `components/TranscriptionDisplay.tsx` - transcription state and rendering.
- `components/CompactCopilot.tsx` - compact overlay mode.
- `components/InterviewPresets.tsx`, `hooks/usePresets.ts`, `hooks/useNotes.ts`, `hooks/useExport.ts` - user productivity features around the core assistant.

## 3. Desktop security model

### 3.1 Window hardening

`electron/main.ts` configures the BrowserWindow to reduce leakage and navigation risk:

- `contextIsolation: true`, `sandbox: true`, and `nodeIntegration: false` keep Node out of the renderer.
- `setContentProtection(true)` hides the window from OS screen capture paths.
- On macOS, `setSharingType("none")` and `setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })` keep the window visible to the user but protected from capture.
- Navigation is locked down so only trusted origins can load inside the window; external links are sent to the default browser.

### 3.2 CSP and origin checks

The main process installs a strict content-security policy and an origin-header injection layer before loading the app. The worker also enforces trusted origins through its own allowlist so desktop requests and browser requests agree on what is permitted.

### 3.3 Preload API surface

`electron/preload.ts` exposes only the capabilities the UI needs:

- Window controls: minimize, maximize, close, always-on-top, resize, ignore mouse events.
- App lifecycle: quit and relaunch.
- Screen capture controls: get access state, open OS settings, trigger the macOS permission prompt, capture a screenshot, listen for capture-and-ask.
- Platform flags: `platform`, `isElectron`, `supportsSystemAudio`.

This is the only bridge the renderer gets. No direct filesystem, shell, or arbitrary IPC access.

## 4. Audio and screenshot capture

### 4.1 System audio capture without virtual drivers

The app captures speaker output using Electron's display-media handler and OS-native loopback audio instead of third-party virtual devices.

`electron/security/permissions.ts` installs the media handler:

- `setPermissionRequestHandler` auto-grants `media`, `display-capture`, and `notifications` only for trusted renderer origins.
- `setPermissionCheckHandler` allows Chromium's synchronous `media` permission checks so `getUserMedia` can reach the native macOS permission path instead of being short-circuited inside Electron.
- `setDisplayMediaRequestHandler` returns the primary screen plus `audio: "loopback"` so Chromium gets system audio natively.

This keeps the user off BlackHole, VB-Audio, Voicemeeter, and similar drivers.

### 4.2 macOS permission flow

macOS gates both screen capture and microphone capture behind TCC permissions.

Screen capture is handled with a dedicated onboarding flow:

- `components/ScreenRecordingOnboard.tsx` polls permission state.
- `screen:trigger-prompt` in `electron/ipc/screen.ts` triggers the native prompt by calling `desktopCapturer.getSources()`.
- `screen:open-settings` opens the right system settings page.
- If permission is granted, the app relaunches so the OS can apply the updated TCC state cleanly.

Ask AI microphone capture is handled separately:

- `electron/main.ts` checks `systemPreferences.getMediaAccessStatus("microphone")` during startup.
- If the status is `not-determined`, the app awaits `systemPreferences.askForMediaAccess("microphone")` before creating the renderer window, so the first Ask AI `getUserMedia` call does not race the OS prompt.
- If the status is `denied` or `restricted`, the app opens the macOS Microphone privacy pane so the user can grant access manually.
- Packaged macOS builds include `NSMicrophoneUsageDescription` in `package.json` and the `com.apple.security.device.audio-input` entitlement through `build/entitlements.mac.plist` and `build/entitlements.mac.inherit.plist`.

### 4.3 Screenshot capture for Ask AI

`electron/ipc/screen.ts` also implements one-shot screenshot capture:

- It grabs the primary display with `desktopCapturer`.
- It downsizes large captures to keep model payloads manageable.
- It returns a PNG data URL to the renderer.

The global hotkey `CommandOrControl+Shift+1` is registered in the main process and sends `screen:capture-and-ask` to the renderer. The Ask AI UI then attaches the screenshot to the next request.

## 5. Transcription pipeline

### 5.1 Capture and chunking

The renderer captures the loopback stream with `navigator.mediaDevices.getDisplayMedia({ video: true, audio: true })`, immediately stops the video track, and keeps only the audio track.

That stream is passed into `MediaRecorder` with a 250 ms timeslice so the app emits a small audio chunk every quarter second.

### 5.2 Deepgram key minting

The worker mints short-lived Deepgram keys on demand:

- `GET /api/deepgram` and `GET /api/deepgram/ask` are the live routes, with legacy aliases `/deepgram` and `/deepgram/ask` supported.
- The worker checks authentication, rate limits requests, and optionally binds a key to a live session row.
- The project key never reaches the client.
- The minted key TTL is 60 seconds in the current implementation, which keeps any leaked token tightly bounded.

The Ask AI mic-only flow uses its own route so it can be tracked separately from the live interview transcription flow.

### 5.3 Deepgram streaming

The live interview transcription client opens a WebSocket to Deepgram with `model=nova-3`, diarization, multi-language detection, and endpointing enabled. Interim results drive the grey live transcription line and final results are appended to the transcript list.

Ask AI microphone dictation uses `hooks/useAskMic.ts`, mints a key from `/api/deepgram/ask`, opens its own short-lived Deepgram live WebSocket, and streams microphone chunks from `MediaRecorder`. `hooks/useMicPushToTalk.ts` owns Space / Ctrl+Space push-to-talk behavior, tap-toggle behavior, and the release timing guard so a slow key or WebSocket handshake does not cancel a session before recording starts.

### 5.4 Session tracking

The worker also exposes session lifecycle endpoints:

- `POST /api/sessions/start`
- `POST /api/sessions/end`
- `POST /api/sessions/end-all`

Those routes help recover from hard-killed processes and support the usage and admin views.

## 6. Ask AI and completion pipeline

### 6.1 User-facing modes

The app uses the same worker completion endpoint for multiple modes:

- Copilot: answer the latest interview question from the live transcript.
- Summarizer: condense the conversation so far.
- Ask AI: direct question answering, optionally with an attached screenshot.

The main completion endpoint is `POST /api/completion`.

### 6.2 Request validation

The worker validates:

- Prompt and background text length.
- Message count limits.
- Image payload shape.
- Custom base URL safety when a user is configured for an OpenAI-compatible model endpoint.

Vision payloads are restricted to image data URLs the worker accepts. The shared client-side helper in `lib/vision-screenshot.ts` mirrors the worker's accepted MIME types so the UI can reject invalid captures early.

### 6.3 Prompt construction

The worker builds Copilot and Summarizer prompts server-side in `realtime-worker-api/src/lib/prompt.ts`, which keeps transcript logic and final answer style distinct.

Ask AI chat also carries a frontend background instruction, `ASK_AI_BACKGROUND`, in both `components/QuestionAssistant.tsx` and `components/CompactCopilot.tsx`. The client sends that background with the first turn through `hooks/useAskChat.ts`; the worker applies it to the request without repeating it on every turn. Screenshot-only Ask AI requests use `VISION_FALLBACK_PROMPT` from `lib/vision-screenshot.ts`.

### 6.4 Provider abstraction

The completion route chooses between two provider paths:

- Gemini through the Cloudflare / Google path, which is the default.
- OpenAI-compatible custom endpoints for users who configure their own model backend.

`realtime-worker-api/src/routes/completion-gemini.ts` and `realtime-worker-api/src/routes/completion-openai.ts` encode the provider-specific wire format, while `realtime-worker-api/src/routes/completion.ts` owns validation, rate limiting, usage tracking, and the SSE response contract.

### 6.5 SSE response format

The worker streams plain SSE frames containing JSON payloads:

- `{ "text": "..." }` for tokens.
- `{ "error": "..." }` for failures.
- `[DONE]` as the terminator.

The client parses these streams with the shared helper in `lib/sse.ts`, which preserves the same carry-buffer semantics across the different UI surfaces.

### 6.6 Screenshot attachment flow

When the user hits the hotkey:

1. The main process captures a screenshot.
2. The renderer receives it through `screen:capture-and-ask`.
3. `QuestionAssistant.tsx` stores the data URL and adds it to the next completion request.
4. The worker converts it into the provider-specific multimodal format.

For Gemini, the image becomes `inlineData`. For OpenAI-compatible endpoints, the worker emits the standard multimodal `messages` array with `image_url` entries.

## 7. Worker API surface

`realtime-worker-api/src/index.ts` is a dispatcher. It routes requests to specialized handlers and applies shared cross-cutting concerns such as CORS and origin gating.

### 7.1 Public routes

| Route | Purpose |
|---|---|
| `POST /api/auth/*` | Better Auth signup, signin, and session handling |
| `GET /api/deepgram` | Mint short-lived Deepgram keys for live transcription |
| `GET /api/deepgram/ask` | Mint short-lived Deepgram keys for Ask AI mic capture |
| `POST /api/completion` | Stream Copilot / Summarizer / Ask AI completions |
| `POST /api/export` | Export session data as markdown or HTML |
| `GET /api/notes` / `POST /api/notes` / `DELETE /api/notes/:id` | Saved interview notes |
| `GET /api/presets` | Interview preset templates and background context |
| `GET /api/usage/me` | User usage summary |
| `POST /api/sessions/start` / `POST /api/sessions/end` / `POST /api/sessions/end-all` | Session lifecycle management |
| `POST /api/events/track` | Analytics and product events |
| `GET /api/support/messages` / `POST /api/support/messages` / `POST /api/support/messages/read` | Support threads |
| `GET /api/announcements/active` / `POST /api/announcements/:id/dismiss` / `POST /api/announcements/:id/ack` | In-app announcements |

The worker also keeps backward-compatible aliases for some routes without the `/api` prefix.

### 7.2 Authentication

`realtime-worker-api/src/auth.ts` uses Better Auth with a Drizzle SQLite adapter.

Key points:

- Email/password auth is enabled.
- Passwords are hashed and verified in worker code.
- Trusted browser origins are explicitly allowlisted.
- Cookies are configured with `SameSite=None` and `Secure` because the desktop app and worker are not same-site in the normal browser sense.
- The self-hosted admin plugin controls approval, banning, and administrative configuration.
- Disposable-email blocking and rate limits are enforced at the auth layer.

### 7.3 Config and secrets

Runtime config is loaded from Cloudflare environment bindings and per-user configuration stored in D1. The worker can read:

- Gemini model and key configuration.
- Deepgram project key for minting short-lived tokens.
- Custom model base URL and API key.
- Admin email list and auth secret material.

The desktop app only receives the minimal session-scoped values it needs.

## 8. Data model

The database lives in Cloudflare D1 and is managed with Drizzle migrations. The schema is organized around a few functional groups:

- Users, sessions, and OAuth/account links.
- Per-user config and feature settings.
- Live interview sessions and Deepgram key bindings.
- Saved notes and interview presets.
- Support threads and announcements.
- Usage, audit, and security events.

The architecture keeps the operational data in the worker's database rather than inside the desktop binary.

## 9. Security and privacy posture

The current security model is built around explicit trust boundaries and short-lived credentials.

### 9.1 Main defenses

- System audio is captured with OS-native loopback support, not a third-party audio driver.
- The desktop app window is content-protected and hard to capture.
- Renderer access is limited to a preload-defined API.
- The worker enforces trusted origins before accepting state-changing requests.
- Rate limiting is applied to auth, Deepgram key minting, and completions.
- Model API keys and Deepgram project keys never ship in the desktop app.
- Image input is restricted to validated data URLs and size bounds.
- Network calls are made over HTTPS.

### 9.2 Operational privacy

The app is intentionally conservative about logging. Prompt text, API keys, and other sensitive user data should not be logged unless a specific debug path requires it. The privacy policy in `PRIVACY.md` is the source of truth for user-facing data handling.

## 10. Build and packaging

### 10.1 Local development

The main workflows are driven by `package.json`:

- `bun run electron:dev` builds the Electron TypeScript files, starts Next.js, and launches Electron against the dev server.
- `bun run electron:debug` does the same but opens DevTools automatically.
- `bun run electron:build` compiles the Electron scripts, builds the Next.js app, and hands off to `electron-builder`.

### 10.2 Electron compilation

`scripts/build-electron.js` resolves the local TypeScript compiler directly with `require.resolve("typescript/bin/tsc")` and compiles `electron/main.ts` and `electron/preload.ts` into `electron/`. That avoids relying on an external `tsc` binary and keeps builds consistent across platforms.

### 10.3 Packaging targets

The app is configured to produce:

- macOS: `dmg`, `zip`
- Windows: `nsis`
- Linux: `AppImage`, `deb`

The release pipeline currently publishes macOS and Windows artifacts. Linux support exists in the packaging config, but it is not part of the default release matrix.

macOS packaging uses Electron Builder entitlements from `build/entitlements.mac.plist` and `build/entitlements.mac.inherit.plist`. Those entitlements include `com.apple.security.device.audio-input`, which is required for packaged builds to appear in macOS Microphone privacy settings and receive microphone access.

### 10.4 Homebrew cask

`scripts/update-homebrew-cask.js` regenerates the Homebrew cask version and SHA256 from the release artifacts. The cask update is part of the release flow so macOS users can install with Homebrew after each tagged release.

## 11. Release pipeline

`.github/workflows/release.yml` drives the release process.

### 11.1 Triggering

- Pushes of tags matching `v*`.
- Manual `workflow_dispatch` with a tag name.

### 11.2 Build job

The build job runs on macOS and Windows:

- Installs Bun and Node 20.
- Runs `bun install --frozen-lockfile`.
- Trusts only the native packages that need postinstall scripts.
- Builds Electron and Next.js.
- Packages the app with `electron-builder`.
- On macOS, verifies the packaged `.app` contains `com.apple.security.device.audio-input` and `NSMicrophoneUsageDescription` before uploading artifacts.
- Uploads DMG, ZIP, EXE, and blockmap artifacts.

### 11.3 Release job

The release job downloads all build artifacts and publishes a GitHub Release with generated release notes.

### 11.4 Tap update job

The tap job regenerates the Homebrew cask and, if the Homebrew tap token is present, pushes the updated cask to the external tap repository. If the token is missing, the job skips cleanly instead of blocking the release.

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
2. The Electron main process routes system audio into Chromium via loopback capture.
3. The renderer chunks that audio with `MediaRecorder` and sends it to Deepgram.
4. Deepgram returns interim and final transcript results.
5. The UI updates the live transcript and, in Copilot mode, sends the latest question context to the worker.
6. The worker validates the request, resolves the user config, and streams a completion from Gemini or a custom OpenAI-compatible model.
7. The renderer consumes the SSE stream and paints the answer as it arrives.
8. If the user hits the screenshot hotkey, the desktop app captures the screen, attaches the image, and repeats the completion path with multimodal input.

From the user's point of view, the whole loop is one continuous assistant experience. Under the hood, it is a chain of tightly scoped components with explicit trust boundaries.

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
- `hooks/useAskMic.ts`
- `hooks/useMicPushToTalk.ts`
- `lib/sse.ts`
- `lib/vision-screenshot.ts`
- `realtime-worker-api/src/index.ts`
- `realtime-worker-api/src/auth.ts`
- `realtime-worker-api/src/routes/completion.ts`
- `realtime-worker-api/src/routes/deepgram.ts`
- `.github/workflows/release.yml`
- `scripts/build-electron.js`
- `scripts/update-homebrew-cask.js`
