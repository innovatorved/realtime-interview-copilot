# Realtime interview copilot

## Description

Realtime Interview Copilot is a web application that assists users in crafting responses during interviews. It leverages real-time audio transcription and AI-powered response generation to provide relevant and concise answers based on interview conversations.

## Technologies

- Frontend: React, TypeScript, Next.js 14, Tailwind CSS, Shadcn/UI
- Backend: Next.js API routes with Edge Runtime
- APIs: Deepgram (speech recognition), OpenRouter (AI models)
- Models: OpenAI (GPT-4o), Anthropic (Claude), Google (Gemini), Mistral, Qwen

## Architecture

The application follows a modern React architecture with Next.js:

- **Frontend**: Client-side React components with TypeScript
- **Backend**: Next.js API routes for AI completion and Deepgram integration
- **State Management**: React useState and useEffect hooks for local state management
- **API Integration**: Fetch API for backend communication

## Core components

### Main components

- **`main.tsx`**: Entry point that renders the Copilot and History components, manages saved data in localStorage
- **`copilot.tsx`**: Core component that handles transcription, model selection, and completion requests
- **`recorder.tsx`**: Manages audio recording and real-time speech transcription with Deepgram
- **`History.tsx`**: Displays saved responses with delete functionality

### UI components

- **UI components**: Built with Shadcn/UI library (button, textarea, select, switch)
- **`Loader.tsx`**: Loading indicator component

### Backend APIs

- **`/api/deepgram/route.ts`**: Creates temporary Deepgram API keys for client-side access
- **`/api/completion/route.ts`**: Processes transcription text with selected AI model

### Utility modules

- **`lib/logger.ts`**: Winston-based logging system
- **`lib/utils.ts`**: Utility functions including prompt building
- **`lib/types.ts`**: TypeScript type definitions and enums

## Features

- **Real-time audio transcription**: Records and transcribes speech using Deepgram's API
- **Multi-language support**: Supports both English and Russian transcription
- **AI-powered responses**: Generates contextual responses based on transcribed text
- **Multiple AI models**: Selectable AI models from various providers
- **Dual mode operation**:
  - **Copilot mode**: Provides complete responses to interview questions
  - **Summarizer mode**: Summarizes transcribed text
- **Response history**: Saves and displays previous responses
- **Keyboard shortcuts**: Quick access with Ctrl+Enter (Process), Ctrl+C (Copilot mode), Ctrl+S (Summarizer mode)

## Data flow

1. User speaks or inputs text in the transcription area
2. Audio is captured and sent to Deepgram for transcription
3. Transcribed text is processed through selected AI model
4. AI-generated response is displayed and can be saved

## Installation and setup

1. Clone the repository:

    ```bash
    git clone https://github.com/innovatorved/realtime-interview-copilot.git
    ```

2. Install dependencies:

    ```bash
    yarn install
    ```

3. Create a `.env.local` file in the project root with the following variables:

    ```
    SITE_BASE_URL="http://localhost"
    PORT="3000"
    APP_NAME="Realtime Interview Copilot"
    DEEPGRAM_API_KEY="your_deepgram_api_key"
    MODEL="openai/gpt-4o-mini"
    OPENAI_API_KEY="your_openrouter_api_key"
    OPENAI_BASE_URL="https://openrouter.ai/api/v1"
    ```

## Usage

1. Run the development server:

    ```bash
    yarn dev
    ```

2. Access the application at http://localhost:3000
3. Provide interview background information (optional)
4. Select preferred language (EN/RU) and AI model
5. Click "Start listening" to begin capturing audio
6. The transcribed text appears in the Transcription field
7. Choose between Copilot or Summarizer mode
8. Click "Process" (or press Ctrl+Enter) to generate AI response
9. Save valuable responses to the history section

## Known issues

- Hydration errors related to `data-redeviation-bs-uid` attributes
- Occasional connection issues with Deepgram API key fetching
- Short lifespan (10 seconds) of temporary Deepgram API keys

## Contributing

Contributions are welcome! Please refer to the [CONTRIBUTING.md](CONTRIBUTING.md) file for guidelines.

## License

This project is licensed under the [License](LICENSE). See the LICENSE file for details.
