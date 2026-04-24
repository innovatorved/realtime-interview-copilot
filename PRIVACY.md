# Privacy Policy

Realtime Interview Copilot is an open-source desktop application maintained by
Ved Gupta. This document explains what data the application handles, what
leaves your device, and what your rights are.

---

## 1. Summary

- The desktop application itself collects **no analytics, telemetry, or
  crash data**. There is no silent tracking.
- To be useful, the app sends the audio it captures to a speech-to-text
  service (**Deepgram**) and sends your questions — and any screenshots you
  attach — to a large language model provider (**Google Gemini**, or any
  OpenAI-compatible model you configure).
- You control which providers are used and which credentials are used to
  access them.
- Your credentials, interview context, saved answers, and preferences are
  stored locally on your own machine.

---

## 2. What gets sent off your device

When the app is actively running with a live session, the following data is
transmitted over HTTPS from your machine to third-party APIs:

### 2.1 Audio → Deepgram

- **What**: a live audio stream captured from your system output (speakers /
  headphones).
- **To**: Deepgram (`api.deepgram.com`) using your own Deepgram API key or an
  ephemeral key minted by the project's Cloudflare Worker API on your behalf.
- **Why**: to produce the real-time transcript displayed in the app.
- **Retention**: governed by Deepgram's policies. Deepgram's terms of service
  and privacy policy state that streaming audio is processed in real time
  and that customers can request data-retention controls on their account.
  See https://deepgram.com/privacy and https://deepgram.com/terms-of-service.
- **Our access**: the application does not keep a copy of the audio after
  the session ends. Nothing is uploaded to a server operated by this
  project.

### 2.2 Prompts + optional screenshots → AI provider

- **What**: your typed question, any relevant transcript context you choose
  to include, and — if you press `⌘⇧1` or click the camera button — a PNG
  screenshot of your primary display.
- **To**: one of
  - **Google Gemini** via `generativelanguage.googleapis.com` (default), or
  - any **OpenAI-compatible** endpoint you configure (e.g. OpenAI, Azure
    OpenAI, a self-hosted model, etc.).
- **Why**: to generate the streaming AI answer shown in the app.
- **Retention**: governed by the provider you select.
  - Google Gemini API: https://policies.google.com/privacy and
    https://ai.google.dev/gemini-api/terms
  - OpenAI: https://openai.com/policies/privacy-policy and
    https://openai.com/policies/api-data-usage-policies (API inputs are not
    used to train OpenAI models by default).
- **Screenshots**: the app never captures a screenshot in the background.
  Captures are only triggered by an explicit hotkey press or button click,
  and you can remove the attachment before submitting.

### 2.3 Optional backend (`realtime-worker-api`)

This project also ships a Cloudflare Worker (optional, self-hostable) that
some users route through in order to avoid distributing API keys. If you use
a deployment of this worker:

- Your email address and a hashed password (via Better Auth) are stored in a
  Cloudflare D1 database operated by whoever hosts that instance.
- Any configuration keys you save (Deepgram key, Gemini key, custom model
  credentials) are stored in that same database, scoped to your account.
- The worker issues short-lived Deepgram keys and proxies completion
  requests to the configured model. Requests are logged only for rate
  limiting and abuse prevention; prompt content is not persisted by the
  worker.

You can avoid this backend entirely by self-hosting it or by configuring
the desktop app to talk to a different endpoint.

---

## 3. What stays local

Stored only on your own machine, in the operating-system-standard
application-support directory:

- API keys (via secure storage where the OS supports it).
- Interview context, notes, saved AI responses, and UI preferences.
- Any transcripts you explicitly export.

No data from step 3 is ever uploaded to servers controlled by this project.

Removing it: uninstall the application and delete the support directory, or
on macOS run `brew uninstall --zap --cask realtime-interview-copilot`.

---

## 4. Cookies, analytics, advertising

None. The desktop application does not use cookies, analytics SDKs,
advertising identifiers, or fingerprinting. A future release may add opt-in,
anonymous crash reporting; if so, it will be disabled by default and
announced in the release notes.

---

## 5. Your rights

Because the desktop application stores your data locally and does not
operate any user-tracking service, you already have full control over it.
For data held by third-party providers (Deepgram, Gemini, OpenAI, etc.),
exercise your rights (GDPR / CCPA access, deletion, portability) directly
with that provider under the account you used.

For data held in a community-run `realtime-worker-api` instance, contact the
operator of that instance. For the author's reference deployment, contact
the email below.

---

## 6. Children

The project is not directed at children under 13, and knowingly collects no
personal information from them.

---

## 7. Security

- Releases are distributed only via GitHub Releases and Homebrew.
- macOS builds are ad-hoc signed; Windows builds are currently unsigned
  (users bypass SmartScreen via "More info → Run anyway").
- All network traffic uses HTTPS.
- Reporting security issues: email the address below. Please do not open a
  public issue for security reports.

---

## 8. Changes

Material changes to this policy will be noted in the project's release
notes.

---

## 9. Contact

Ved Gupta · vedgupta@protonmail.com ·
https://github.com/innovatorved/realtime-interview-copilot/issues
