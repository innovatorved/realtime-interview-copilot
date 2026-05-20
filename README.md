# Realtime Interview Copilot

Desktop app for live interview assistance. It captures system audio, transcribes speech in real time, and can answer questions using text or screenshots.

## About

I’m Ved Gupta. I built this project to make live interview support faster and less distracting.

Contact: [vedgupta@protonmail.com](mailto:vedgupta@protonmail.com)

If you find the project useful, please star the repo on GitHub.

## Install

macOS:

```bash
brew tap innovatorved/tap
brew install --cask realtime-interview-copilot
```

Windows releases are available on the GitHub Releases page.

## Features

- Live transcription of system audio
- AI answers from text or screenshots
- Hidden window for screen sharing
- Keyboard shortcuts for quick actions

## Development

```bash
git clone https://github.com/innovatorved/realtime-interview-copilot.git
cd realtime-interview-copilot
bun install
bun run electron:dev
```

Build installers with:

```bash
bun run electron:build
```

## Requirements

Node 20+ and Bun 1.3+

## Links

- [Releases](https://github.com/innovatorved/realtime-interview-copilot/releases/latest)
- [Contributing](./CONTRIBUTING.md)
- [License](./LICENSE)
- [Privacy Policy](./PRIVACY.md)
- [Issues](https://github.com/innovatorved/realtime-interview-copilot/issues)
