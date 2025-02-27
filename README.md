# Realtime Interview Copilot

## Description

Realtime Interview Copilot is a web application that assists users in crafting responses during interviews. It leverages real-time audio transcription and AI-powered response generation to provide relevant and concise answers.

## Technologies

- Frontend: React, TypeScript, Next.js, Tailwind CSS, Shadcn/UI
- Backend: Node.js
- APIs: Deepgram (transcription), OpenAI/Groq/Mistral (response generation)

## Features

- Real-time audio transcription using Deepgram
- AI-powered response generation using OpenAI/Groq/Mistral
- Customizable interview background information
- Transcription text editing
- Toggle between Copilot and Summerizer modes
- Audio capture from both microphone and screen (browser tabs)

## Installation and Setup

1. Clone the repository:

    ```bash
    git clone https://github.com/innovatorved/realtime-interview-copilot.git
    ```

2. Install dependencies:

    ```bash
    yarn install
    ```

3. Create a `.env.local` file in the project root and add the following environment variables:

    ```
    OPENAI_API_KEY="your-openai-api-key"
    DEEPGRAM_API_KEY=your-deepgram-api-key-without-quotes
    MODEL="gpt-3.5-turbo-instruct"
    OPENAI_BASE_URL="https://api.openai.com/v1"
    ```

    **Important Notes:**
    - For the Deepgram API key, make sure it has the `keys:write` permission. This is required because the application creates temporary API keys for security purposes.
    - You can create a Deepgram API key with the necessary permissions in the [Deepgram Console](https://console.deepgram.com/) by selecting the Administrator role or explicitly adding the `keys:write` permission (There should be a Advanced Tab below).
    - Do not add quotes around the Deepgram API key in the .env.local file.

## Usage

1. Run the development server:

    ```bash
    yarn dev
    ```

2. Access the application in your browser at http://localhost:3000.
3. Provide interview background information in the "Interview Background" section.
4. Select your audio capture source (microphone, screen, or both).
5. Start listening to the interview conversation by clicking the "Start listening" button.
6. The transcribed text will appear in the "Transcription" section. You can edit it if needed.
7. Choose between Copilot or Summerizer mode using the toggle switch.
8. Click the "Process" button to generate AI-powered responses based on the transcribed text and background information.

## Troubleshooting

### "Loading temporary API key..." Message

If you see this message and the application is stuck, it's likely because your Deepgram API key doesn't have the required permissions. The application needs to create temporary API keys, which requires the `keys:write` permission.

**Solution:** Create a new Deepgram API key with the Administrator role or explicitly add the `keys:write` permission.

### API Endpoint Errors

If you encounter errors related to the OpenAI API, check that your MODEL environment variable matches the correct endpoint:

- For `gpt-3.5-turbo-instruct`, use the completions endpoint (already configured)
- For chat models like `gpt-3.5-turbo` or `gpt-4`, you would need to modify the code to use the chat.completions endpoint

## Contributing

Contributions are welcome! Please refer to the [CONTRIBUTING.md](https://github.com/innovatorved/realtime-interview-copilot/blob/main/CONTRIBUTING.md) file for guidelines.

## License

This project is licensed under the [License](https://github.com/innovatorved/realtime-interview-copilot/blob/main/LICENSE). See the LICENSE file for details.
