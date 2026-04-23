# Realtime Interview Copilot - Desktop App

## Description

Realtime Interview Copilot is an Electron desktop application that provides real-time AI assistance during interviews. It transcribes audio in real-time using Deepgram, allows users to ask questions to an AI assistant, and generates AI-powered responses based on interview context and transcription.

## 📥 Downloads

Download the latest version associated with the release tag `v0.1.0` from our [Releases Page](https://github.com/innovatorved/realtime-interview-copilot/releases/tag/v0.1.0).

## Features

- 🎤 **Real-time Audio Transcription** - Capture and transcribe interview audio using Deepgram
- 🤖 **AI-Powered Assistance** - Get intelligent responses and suggestions powered by Google Generative AI
- 💬 **Interactive AI Assistant** - Ask questions anytime during the interview
- 📝 **Dual Modes** - Switch between Copilot (answer suggestions) and Summarizer (conversation summary)
- 🎯 **History Management** - Save and review important responses
- ⌨️ **Keyboard Shortcuts** - Quick access to common actions
- 🔒 **Screen Share Protection** - App window is protected and not visible during screen sharing
- 🖥️ **Cross-Platform** - Available for macOS, Windows, and Linux

## Platform Support

> ⚠️ **Note**: This application has been tested and verified on **macOS** only. If you're using **Windows** or **Linux**, please test thoroughly before using it in actual interviews. Contributions and feedback for other platforms are welcome!

## Technologies

- **Frontend**: React, TypeScript, Next.js, Tailwind CSS, Shadcn/UI
- **Desktop**: Electron
- **APIs**: Current APIs used are Deepgram for transcription and Google Generative AI. Backend API is hosted on [https://realtime-worker-api.innovatorved.workers.dev/](https://realtime-worker-api.innovatorved.workers.dev/) and [https://realtime-worker-api-prod.vedgupta.in/](https://realtime-worker-api-prod.vedgupta.in/)

## Prerequisites

### System Audio Capture (No virtual drivers required)

The desktop app captures your loudspeaker / system audio natively using Electron's built-in display-media loopback — **no BlackHole, VB-Cable, or Voicemeeter needed**.

- **macOS**: On first launch, grant **Screen Recording** permission (System Settings → Privacy & Security → Screen Recording → enable *Realtime Interview Copilot*), then restart the app. After that, capture is silent — no picker, no extra prompts.
- **Windows**: Capture works out of the box using WASAPI loopback. If a one-time share prompt appears, click **Share**.
- **Linux**: Use a PulseAudio/PipeWire monitor source. Any app that exposes a loopback/monitor input will work.
- **Browser build**: Uses the standard `getDisplayMedia` picker — choose the tab or window and enable **Share audio** / **Share tab audio**.

## Installation and Setup

### 1. Clone the Repository

```bash
git clone https://github.com/innovatorved/realtime-interview-copilot.git
cd realtime-interview-copilot
```

### 2. Install Dependencies

```bash
bun install
```

### 3. Run the Application

**Development Mode**:

```bash
bun run electron:dev
```

**Debug Mode** (with developer tools):

```bash
bun run electron:debug
```

**Build for Production**:

```bash
bun run electron:build
```

The built application will be in the `dist` directory:

- **macOS**: `.dmg` and `.zip` files
- **Windows**: `.exe` installer and portable version
- **Linux**: `.AppImage` and `.deb` packages

## Authentication & Database Setup

This project uses **Better Auth** for authentication and **Cloudflare D1** as the database.

### 1. Database Setup (Cloudflare D1)

The application requires a Cloudflare D1 database to store user and session data.

1. **Create a new D1 database**:
  ```bash
    npx wrangler d1 create realtime-interview-copilot-db
  ```
2. **Update Configuration**:
  Copy the `database_id` from the output of the previous command and update `realtime-worker-api/wrangler.toml`:
3. **Generate Migrations**:
  Navigate to the worker directory and generate the database schema migrations:
4. **Apply Migrations**:
  Apply the migrations to your remote Cloudflare D1 database:
    *(For local development, you can use `npx wrangler d1 migrations apply realtime-interview-copilot-db --local`)*

### 2. Authentication Setup

The authentication is handled by the `realtime-worker-api`. Ensure you have configured the necessary environment variables if you are using social providers (e.g., Google, GitHub).

## Usage Guide

### Initial Setup

1. **Launch the Application** - Open Realtime Interview Copilot
2. **Grant Permissions** (first run only):
  - **macOS**: Allow Screen Recording for the app in System Settings → Privacy & Security, then relaunch
  - **Windows**: Click *Share* if a one-time prompt appears
3. **Enter Interview Context** - Provide background information about the interview (role, company, topics)

### During Interview

1. **Start Recording** 🎤
  - Click the microphone button to begin audio capture
  - Real-time transcription will appear on screen
2. **Choose Mode**:
  - **Copilot Mode** (C) - Get AI-suggested answers to interview questions
  - **Summarizer Mode** (S) - Generate a summary of the conversation
3. **Generate AI Response**:
  - Click **Process** or press **Enter** to generate AI assistance
  - The AI will analyze the transcription and context
4. **Ask Questions** 💬:
  - Press **K** to open the floating AI Assistant
  - Type your question and press Enter
  - Get instant answers during the interview
5. **Save Important Responses** 📝:
  - Click **Save to History** to store useful answers
  - Access saved responses from the History panel

### Keyboard Shortcuts

Boost your productivity with these shortcuts (disabled when typing in inputs):


| Shortcut | Action                               |
| -------- | ------------------------------------ |
| `K`      | Focus the floating Ask AI input box  |
| `S`      | Switch to Summarizer mode            |
| `C`      | Switch to Copilot mode               |
| `Enter`  | Submit / Process (when not in input) |
| `Escape` | Clear the current AI answer          |


**Note**: Shortcuts are automatically disabled when typing in inputs to prevent conflicts.

## Privacy & Security

### Screen Share Protection

The application window is **protected from screen sharing** - it will not be visible when you share your screen during video interviews. This ensures your AI assistance remains private and confidential during the interview process.

## Troubleshooting

### Common Issues

#### No Audio Detected

- **macOS**: Open System Settings → Privacy & Security → Screen Recording and confirm *Realtime Interview Copilot* is enabled, then fully quit and relaunch the app
- **Windows**: If nothing is transcribed, make sure audio is actually playing through the default output device; loopback captures whatever the OS sends to the speakers/headphones
- **Test system audio** - Play a sound to confirm the OS is routing audio to the active output

#### App Won't Start

- **Check Node.js version** - Ensure you're using Node.js 20 or higher
- **Clear cache** - Run `bun run clean` and rebuild
- **Reinstall dependencies** - Delete `node_modules` and run `bun install`

### Development Tips

**Clean build artifacts**:

```bash
bun run clean
```

**View detailed logs** (development):

```bash
bun run electron:debug
```

**Rebuild only Electron files**:

```bash
bun run build:electron
```

## Contributing

Contributions are welcome! Here's how you can help:

1. **Fork the repository**
2. **Create a feature branch** (`git checkout -b feature/amazing-feature`)
3. **Commit your changes** (`git commit -m 'Add amazing feature'`)
4. **Push to the branch** (`git push origin feature/amazing-feature`)
5. **Open a Pull Request**

Please refer to [CONTRIBUTING.md](https://github.com/innovatorved/realtime-interview-copilot/blob/main/CONTRIBUTING.md) for detailed guidelines.

**Testing on Windows/Linux**: Since this app has only been tested on macOS, we especially welcome contributions that test and improve compatibility on Windows and Linux platforms.

## License

This project is licensed under the terms specified in the [LICENSE](https://github.com/innovatorved/realtime-interview-copilot/blob/main/LICENSE) file.

## Acknowledgments

- [Deepgram](https://deepgram.com/) - Real-time speech recognition
- [Google Generative AI](https://ai.google.dev/) - AI-powered responses
- [Electron](https://www.electronjs.org/) - Cross-platform desktop framework
- [Next.js](https://nextjs.org/) - React framework

## Support

For issues, questions, or suggestions:

- 🐛 [Report a bug](https://github.com/innovatorved/realtime-interview-copilot/issues)
- 💡 [Request a feature](https://github.com/innovatorved/realtime-interview-copilot/issues)
- 📧 [vedgupta@protonmail.com](mailto:vedgupta@protonmail.com)

---

**⚠️ Disclaimer**: This tool is for educational and assistance purposes. Always check your interview platform's terms of service regarding the use of AI assistance tools.