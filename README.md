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

To update an existing Homebrew install:

```bash
brew update
brew upgrade --cask realtime-interview-copilot
```

If the upgrade fails, reinstall:

```bash
brew reinstall --cask realtime-interview-copilot
```

Homebrew-managed installs should use `brew upgrade` rather than the in-app updater.

Windows (WinGet, one command):

```powershell
irm https://raw.githubusercontent.com/innovatorved/winget/main/install-realtime-interview-copilot.ps1 | iex
```

To update an existing WinGet install, re-run the same command.

To uninstall:

```powershell
winget uninstall -e --id Innovatorved.RealtimeInterviewCopilot
```

WinGet-managed installs should use the install script above rather than the in-app updater. Windows builds are unsigned; SmartScreen may prompt on first launch (**More info → Run anyway**).

Manual downloads are also on the [GitHub Releases](https://github.com/innovatorved/realtime-interview-copilot/releases/latest) page.

## Features

- Live transcription of system audio (no virtual audio driver required on macOS)
- AI answers from transcript, typed questions, or screenshots
- **Compact mode** — picture-in-picture overlay with click-through; toolbar stays interactive while empty space passes clicks to apps behind
- **Backdrop slider** — Title bar **− / +** controls window transparency (full mode dims the whole UI; compact mode dims only the title bar and toolbar strip)
- Hidden from normal screen sharing (`contentProtection` + macOS sharing settings)
- In-app **Check for updates** (Title bar download icon); Homebrew and WinGet installs should use their package manager instead
- Keyboard shortcuts (see below)

### Keyboard shortcuts


| Action                         | macOS                               | Windows               |
| ------------------------------ | ----------------------------------- | --------------------- |
| Switch tab (full mode)         | ⌥C Copilot · ⌥A Ask AI · ⌥N Notes | Alt+C / A / N         |
| Generate Copilot answer        | ⌘Enter                              | Ctrl+Enter            |
| Summarize transcript           | ⌘⇧Enter                             | Ctrl+Shift+Enter      |
| Toggle Ask drawer (compact)    | ⌥A                                  | Alt+A                 |
| New Ask chat                   | ⌘⇧N                                 | Ctrl+Shift+N          |
| Push-to-talk mic (empty input) | Space (hold)                        | Space (hold)          |
| Attach screenshot              | ⌘⇧1 (global)                        | Ctrl+Shift+1 (global) |
| Cancel mic / close drawer      | Esc                                 | Esc                   |


On first launch, macOS may prompt for **Screen Recording** (system audio) and **Microphone** (Ask AI dictation). In compact mode, a small **Screen access** chip opens System Settings without blocking the overlay.

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

Node 22+ and Bun 1.3+

## Links

- [Releases](https://github.com/innovatorved/realtime-interview-copilot/releases/latest)
- [Contributing](./CONTRIBUTING.md)
- [License](./LICENSE)
- [Privacy Policy](./PRIVACY.md)
- [Issues](https://github.com/innovatorved/realtime-interview-copilot/issues)

