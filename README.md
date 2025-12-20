# Realtime Interview Copilot

## Description

Realtime Interview Copilot is a Progressive Web Application (PWA) that provides real-time AI assistance during interviews. It transcribes audio in real-time using Deepgram, allows users to ask questions to an AI assistant, and generates AI-powered responses based on interview context and transcription. The app can be installed on any device for offline access and a native app-like experience.

> **📱 Looking for the Desktop App?**  
> If you're looking for the desktop application code, please check the [`desktop-app`](https://github.com/innovatorved/realtime-interview-copilot/tree/nightly) branch.

## Technologies

- Frontend: React, TypeScript, Next.js, Tailwind CSS, Shadcn/UI
- Backend: Node.js
- APIs: Deepgram (real-time transcription), Google Generative AI (response generation)
- PWA: Service Worker, Web App Manifest


## Installation and Setup

### Prerequisites
- Node.js 20+
- pnpm (or npm/yarn)
- API Keys:
  - Deepgram API key
  - Google Generative AI API key

### Steps

1. Clone the repository:
    ```bash
    git clone https://github.com/innovatorved/realtime-interview-copilot.git
    cd realtime-interview-copilot
    ```

2. Install dependencies:
    ```bash
    pnpm install
    ```

3. Create a `.env.local` file:
    ```
    DEEPGRAM_API_KEY=your_deepgram_api_key
    GOOGLE_GENERATIVE_AI_API_KEY=your_google_ai_api_key
    ```

4. Run the development server:
    ```bash
    pnpm dev
    ```

5. Access at `http://localhost:3000`

## How It Works

### Workflow
1. User enters interview background information
2. Click microphone to start recording/transcription
3. Deepgram API transcribes audio in real-time
4. User chooses Copilot or Summerizer mode
5. Click Process to generate AI response
6. Use AI Assistant box to ask questions anytime
7. Save important responses to history

### AI Assistant Workflow
1. Type question in floating Ask AI box
2. Submit with Enter or click send
3. AI generates detailed answer
4. Minimize box when not needed
5. Drag box to reposition on screen

## Keyboard shortcuts

Realtime Interview Copilot includes several single-key shortcuts to speed up common actions. These shortcuts are disabled while you're typing in any input or textarea so they won't interfere with normal typing.

- K — Focus the floating Ask AI input box
- S — Switch to "Summerizer" mode
- C — Switch to "Copilot" mode
- Enter — Submit / Process (when not focused inside an input/textarea)
- Escape — Clear the current AI answer

Note: Shortcuts are intentionally ignored when an input or textarea has focus to allow normal typing (including using Enter inside inputs).

## API Routes

- `POST /api/completion` - Generate AI responses
- `POST /api/deepgram` - Handle Deepgram key generations

## Contributing

Contributions are welcome! Please refer to the [CONTRIBUTING.md](https://github.com/innovatorved/realtime-interview-copilot/blob/main/CONTRIBUTING.md) file for guidelines.

## License

This project is licensed under the [License](https://github.com/innovatorved/realtime-interview-copilot/blob/main/LICENSE). See the LICENSE file for details.
