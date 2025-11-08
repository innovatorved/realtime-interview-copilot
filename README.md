# Realtime Interview Copilot - Desktop App

## Description

Realtime Interview Copilot is an Electron desktop application that provides real-time AI assistance during interviews. It transcribes audio in real-time using Deepgram, allows users to ask questions to an AI assistant, and generates AI-powered responses based on interview context and transcription.

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
- **APIs**: Current APIs used are Deepgram for transcription and Google Generative AI. Backend API is hosted on https://realtime-worker-api.innovatorved.workers.dev/

## Prerequisites

### Audio Loopback Setup (Required for capturing system audio)

To capture audio from online interviews (Zoom, Meet, Teams, etc.), you need to route your system audio output to the microphone input using audio loopback software.

#### macOS - BlackHole

1. **Install BlackHole**:
   ```bash
   brew install blackhole-2ch
   ```
   Or download from: https://existential.audio/blackhole/

2. **Create Multi-Output Device**:
   - Open **Audio MIDI Setup** (Applications > Utilities > Audio MIDI Setup)
   - Click the **+** button at the bottom left and select **Create Multi-Output Device**
   - Check both your **speakers/headphones** and **BlackHole 2ch**
   - This allows you to hear audio while routing it to BlackHole

3. **Create Aggregate Device** (for microphone input):
   - In Audio MIDI Setup, click **+** and select **Create Aggregate Device**
   - Check both **BlackHole 2ch** and your **microphone**
   - This combines system audio with your mic input

4. **Configure System Audio**:
   - Go to **System Settings > Sound**
   - Set **Output** to the Multi-Output Device you created
   - In the Realtime Interview Copilot app, select the Aggregate Device as your input

#### Windows - VB-Audio Virtual Cable

1. **Install VB-Audio Virtual Cable**:
   - Download from: https://vb-audio.com/Cable/
   - Run the installer as Administrator
   - Restart your computer after installation

2. **Configure Playback Device**:
   - Right-click the speaker icon in the system tray
   - Select **Sounds** > **Playback** tab
   - Set **CABLE Input** as the default playback device
   - OR use **Voicemeeter** for more advanced routing (recommended)

3. **Configure Recording Device**:
   - In the **Recording** tab
   - Right-click **CABLE Output** and select **Properties**
   - Go to **Listen** tab
   - Check **Listen to this device**
   - Select your speakers/headphones from the dropdown (to hear audio)
   - Click **Apply**

4. **Alternative: Voicemeeter Banana** (Recommended):
   - Download from: https://vb-audio.com/Voicemeeter/banana.htm
   - Install and configure:
     - Set your browser/app audio output to Voicemeeter Input
     - Route Voicemeeter to your speakers (Hardware Out A1)
     - In Realtime Interview Copilot, select **Voicemeeter Output** as input
   - Voicemeeter provides better control and mixing capabilities

#### Linux - PulseAudio/PipeWire

1. **Using PulseAudio**:
   ```bash
   # Create a null sink
   pactl load-module module-null-sink sink_name=virtual_speaker
   
   # Create a loopback from null sink to your microphone
   pactl load-module module-loopback source=virtual_speaker.monitor
   
   # Redirect application audio to the null sink
   # Set virtual_speaker as output in your interview application
   ```

2. **Using PipeWire** (Modern Linux):
   - Install `helvum` or `qpwgraph` for graphical audio routing
   - Connect your application output to both speakers and recording input

## Installation and Setup

### 1. Clone the Repository
```bash
git clone https://github.com/innovatorved/realtime-interview-copilot.git
cd realtime-interview-copilot
```

### 2. Install Dependencies
```bash
pnpm install
```

### 3. Run the Application

**Development Mode**:
```bash
pnpm electron:dev
```

**Debug Mode** (with developer tools):
```bash
pnpm electron:debug
```

**Build for Production**:
```bash
pnpm electron:build
```

The built application will be in the `dist` directory:
- **macOS**: `.dmg` and `.zip` files
- **Windows**: `.exe` installer and portable version
- **Linux**: `.AppImage` and `.deb` packages

## Usage Guide

### Initial Setup
1. **Launch the Application** - Open Realtime Interview Copilot
3. **Configure Audio**:
   - Select your audio loopback device (Aggregate Device on macOS, CABLE Output on Windows)
   - Ensure your interview platform audio is routed correctly
4. **Enter Interview Context** - Provide background information about the interview (role, company, topics)

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

| Shortcut | Action |
|----------|--------|
| `K` | Focus the floating Ask AI input box |
| `S` | Switch to Summarizer mode |
| `C` | Switch to Copilot mode |
| `Enter` | Submit / Process (when not in input) |
| `Escape` | Clear the current AI answer |

**Note**: Shortcuts are automatically disabled when typing in inputs to prevent conflicts.

## Privacy & Security

### Screen Share Protection
The application window is **protected from screen sharing** - it will not be visible when you share your screen during video interviews. This ensures your AI assistance remains private and confidential during the interview process.

## Troubleshooting

### Common Issues

#### No Audio Detected
- **Check audio loopback setup** - Ensure BlackHole/VB-Cable is properly configured
- **Verify device selection** - Select the correct aggregate/loopback device in the app
- **Test system audio** - Play a sound to confirm audio routing works

#### App Won't Start
- **Check Node.js version** - Ensure you're using Node.js 20 or higher
- **Clear cache** - Run `pnpm clean` and rebuild
- **Reinstall dependencies** - Delete `node_modules` and run `pnpm install`

### Development Tips

**Clean build artifacts**:
```bash
pnpm clean
```

**View detailed logs** (development):
```bash
pnpm electron:debug
```

**Rebuild only Electron files**:
```bash
pnpm build:electron
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
- [BlackHole](https://existential.audio/blackhole/) - macOS audio loopback
- [VB-Audio](https://vb-audio.com/) - Windows virtual audio cable

## Support

For issues, questions, or suggestions:
- 🐛 [Report a bug](https://github.com/innovatorved/realtime-interview-copilot/issues)
- 💡 [Request a feature](https://github.com/innovatorved/realtime-interview-copilot/issues)
- 📧 vedgupta@protonmail.com

---

**⚠️ Disclaimer**: This tool is for educational and assistance purposes. Always check your interview platform's terms of service regarding the use of AI assistance tools.
