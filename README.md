# Realtime Interview Copilot

Real-time AI copilot for interviews. Captures your system audio, transcribes it live with Deepgram, and answers questions on the fly using multimodal AI (text + screenshots). Desktop app window is hidden from screen shares.

## Download

Get the latest build from the [**Releases page**](https://github.com/innovatorved/realtime-interview-copilot/releases/latest):

- **macOS (Apple Silicon)** — `.dmg`
- **Windows (x64)** — `.exe`

### macOS install

The app is ad-hoc signed (not Apple-notarized — notarization requires a $99/yr paid Apple Developer account). You will see *"Apple could not verify … is free of malware"* on first launch. Pick any one option below.

**Option A — Homebrew (recommended, one command)**

```bash
brew tap innovatorved/tap
brew install --cask realtime-interview-copilot
```

The cask automatically removes the quarantine attribute after install, so the app just opens — no warnings.

**Option B — Manual (DMG)**

1. Open the `.dmg`, drag the app to `/Applications`.
2. In Finder, **right-click** *Realtime Interview Copilot Beta* in `/Applications` → **Open** → **Open** on the new dialog.
3. Subsequent launches work normally.

**Option C — System Settings bypass (macOS 15 Sequoia)**

Try launching once, dismiss the block, then go to **System Settings → Privacy & Security → scroll to the bottom → Open Anyway**.

**Option D — Terminal**

```bash
xattr -cr "/Applications/Realtime Interview Copilot Beta.app"
```

### Windows install

The installer is unsigned. SmartScreen may show a warning — click **More info** → **Run anyway**.

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

## License & Contact

[LICENSE](./LICENSE) · [vedgupta@protonmail.com](mailto:vedgupta@protonmail.com) · [Report issues](https://github.com/innovatorved/realtime-interview-copilot/issues)

---

⚠️ For educational use. Check your interview platform's terms before using any AI assistance tool.
