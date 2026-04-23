# Privacy Policy

_Last updated: 2026-04-24_

Realtime Interview Copilot is an open-source desktop application developed by
Ved Gupta. This document describes what data the application handles.

## What we collect

**Nothing.** The desktop application does not include analytics, telemetry,
crash reporting, advertising SDKs, or any other form of silent data
collection. We do not operate servers that track your usage.

## Data you provide yourself

The app functions only when you connect it to third-party services using your
own credentials:

- **Deepgram** — for live audio transcription. Audio captured from your system
  is streamed directly to Deepgram under your API key.
- **Google Gemini** / **OpenAI-compatible providers** — for AI answers. Your
  prompts (and any screenshots you attach with ⌘⇧1) are sent directly to the
  provider you configure.

These providers have their own privacy policies. Please review them:

- Deepgram — https://deepgram.com/privacy
- Google AI / Gemini — https://policies.google.com/privacy
- OpenAI — https://openai.com/policies/privacy-policy

## Local storage

The following data is stored only on your own machine:

- Your API keys (in the operating system's secure storage).
- Interview context, saved answers, and preferences (in the app's local
  application-support directory).

You can remove everything by uninstalling the app and deleting its support
directory, or by running `brew uninstall --zap --cask realtime-interview-copilot`
on macOS.

## Optional backend (self-hosted)

The reference Cloudflare Worker API (`realtime-worker-api/`) is an **optional**
backend that individual users or teams can self-host to manage model
credentials. If you choose to use a maintainer-hosted instance, the only
personal data that instance stores is the email address and hashed password
you use to sign in, plus any application secrets you choose to save under
your account. That data is held in a Cloudflare D1 database under the
operator's control and is never shared with third parties.

## Children

The project is not directed at children under 13.

## Changes

Material changes to this policy will be announced via a new entry in the
project's release notes.

## Contact

Questions or requests: vedgupta@protonmail.com ·
https://github.com/innovatorved/realtime-interview-copilot/issues
