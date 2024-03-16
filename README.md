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

## Installation and Setup

1. Clone the repository:

    ```bash
    git clone https://github.com/your-username/realtime-interview-copilot.git
    ```

2. Install dependencies:

    ```bash
    yarn install
    ```

3. Create a `.env.local` file in the project root and add the following environment variables:

    - `DEEPGRAM_API_KEY`: Your Deepgram API key
    - `OPENAI_API_KEY`: Your OpenAI API key (or GROQ_API_KEY or MISTRAL_API_KEY if using those services)

## Usage

1. Run the development server:

    ```bash
    yarn dev
    ```

2. Access the application in your browser at http://localhost:3000.
3. Provide interview background information in the "Interview Background" section.
4. Start listening to the interview conversation by clicking the "Start listening" button.
5. The transcribed text will appear in the "Transcription" section. You can edit it if needed.
6. Choose between Copilot or Summerizer mode using the toggle switch.
7. Click the "Process" button to generate AI-powered responses based on the transcribed text and background information.

## Contributing

Contributions are welcome! Please refer to the [CONTRIBUTING.md](https://github.com/innovatorved/realtime-interview-copilot/blob/main/CONTRIBUTING.md) file for guidelines.

## License

This project is licensed under the [License](https://github.com/innovatorved/realtime-interview-copilot/blob/main/LICENSE). See the LICENSE file for details.
