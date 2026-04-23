# Realtime Interview Copilot

Real-time AI copilot for interviews. Captures your system audio, transcribes it live with Deepgram, and answers questions on the fly using multimodal AI (text + screenshots). Desktop app window is hidden from screen shares.

## Download

Get the latest build from the [**Releases page**](https://github.com/innovatorved/realtime-interview-copilot/releases/latest) — macOS (Apple Silicon) `.dmg` or Windows (x64) `.exe`.

### macOS

```bash
brew tap innovatorved/tap
brew install --cask realtime-interview-copilot
```

Or grab the DMG and right-click the app → **Open** on first launch.

### Windows

Run the installer. If SmartScreen warns, click **More info → Run anyway**.

## Features

- 🎙️ **Live transcription** of system audio (Deepgram) — no BlackHole / VB-Cable needed
- 🤖 **Ask AI** with streaming answers (Gemini / OpenAI-compatible)
- 🖼️ **Vision** — press `⌘⇧1` to snap your screen and ask AI about it
- 🕵️ **Undetectable** — window is hidden from screen shares and full-screen spaces
- ⌨️ **Shortcuts** — `K` focus Ask AI, `C` Copilot mode, `S` Summarizer, `Escape` clear

## System Audio — No Virtual Drivers

The app uses Electron's native display-media loopback.

- **macOS**: grant *Screen Recording* once (System Settings → Privacy & Security), relaunch. Silent after that.
- **Windows**: works out of the box (WASAPI loopback).
- **Linux**: use any PulseAudio / PipeWire monitor source.

## Development

```bash
git clone https://github.com/innovatorved/realtime-interview-copilot.git
cd realtime-interview-copilot
bun install
bun run electron:dev      # dev
bun run electron:build    # package installers into dist/
```

Requires Node 20+ and [Bun](https://bun.sh) 1.3+.

## Stack

React · Next.js · Electron 41 · Tailwind · Shadcn/UI · Deepgram · Gemini · Cloudflare Workers + D1

## Releases

Tagged pushes (`v*`) trigger a GitHub Actions workflow that builds macOS and Windows artifacts and publishes them to a GitHub Release automatically.

## Contributing

PRs welcome. See [CONTRIBUTING.md](./CONTRIBUTING.md). Windows/Linux test reports especially appreciated.

## Code signing

Windows builds are signed free of charge by the [SignPath Foundation](https://about.signpath.io/), certificate issued by [SignPath](https://signpath.io/). Signing policy and provenance are managed through SignPath.io.

## License, Privacy & Contact

[LICENSE](./LICENSE) · [Privacy Policy](./PRIVACY.md) · [vedgupta@protonmail.com](mailto:vedgupta@protonmail.com) · [Report issues](https://github.com/innovatorved/realtime-interview-copilot/issues)

---

⚠️ For educational use. Check your interview platform's terms before using any AI assistance tool.
