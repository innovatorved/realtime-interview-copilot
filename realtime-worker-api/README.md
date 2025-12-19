# Realtime Worker APIs

Cloudflare Worker that exposes two endpoints equivalent to the Next.js APIs in `realtime-interview-copilot`:

- `POST /api/deepgram` – generate a short-lived Deepgram API key.
- `POST /api/completion` – stream responses from Google Gemini (via SSE).

## Setup

1. Install dependencies:
   ```bash
   npm install
   ```
2. Define the required environment variables before running the worker:
   - `DEEPGRAM_API_KEY`
   - `GOOGLE_GENERATIVE_AI_API_KEY`

   Optional overrides:
   - `GEMINI_MODEL` (defaults to `gemini-3-flash-preview`)

3. Start a local dev server:
   ```bash
   npm run dev
   ```

## API Contracts

### POST /api/deepgram

No payload required. Returns the JSON from Deepgram's temporary key creation endpoint, or an error structure if the upstream call fails.

### POST /api/completion

```json
{
  "bg": "optional background text",
  "flag": "copilot | summerizer | (anything else)",
  "prompt": "text to send to Gemini"
}
```

The response is an SSE stream emitting `data: {"text": "..."}` events until `[DONE]` or an error payload is sent.

## Deployment

Deploy to Cloudflare Workers once bindings are set up:

```bash
npm run deploy
```
