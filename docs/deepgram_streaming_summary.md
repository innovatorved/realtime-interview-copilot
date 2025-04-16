= Deepgram streaming API usage summary

This document summarizes how to use the Deepgram API for real-time audio transcription based on the provided documentation.

== Prerequisites

*   Obtain a Deepgram API key.
*   Configure your environment, especially if using an SDK.

== Using SDKs

Deepgram provides SDKs for various languages (JavaScript, Python, C#, Go).

=== Installation

Install the relevant SDK using your package manager.

.File: Terminal
[source,bash]
----
# Example for JavaScript
npm install @deepgram/sdk

# Example for Python
pip install deepgram-sdk
---- 

=== Dependencies

Depending on the SDK and environment, you might need additional libraries.

.File: Terminal (JavaScript Example)
[source,bash]
----
# Example for JavaScript (Node.js)
npm install cross-fetch dotenv
----

=== Core transcription flow

1.  **Create Client:** Instantiate the Deepgram client with your API key.
2.  **Establish Connection:** Create a live transcription connection, specifying parameters like:
    *   `model`: e.g., "nova-2", "nova-3"
    *   `language`: e.g., "en-US"
    *   `smart_format`: boolean (formats numbers, currency, etc.)
    *   Other features like `interim_results`, `endpointing`, etc.
3.  **Event Listeners:** Set up listeners for events:
    *   `Open`: Connection established.
    *   `Transcript`: Received transcription data (interim or final).
    *   `Metadata`: Received metadata about the stream/model.
    *   `SpeechStarted` / `UtteranceEnd`: If using endpointing.
    *   `Error`: Handle errors.
    *   `Close`: Connection closed.
4.  **Send Audio:** Fetch your audio stream (e.g., from a microphone or URL) and send chunks of audio data through the connection.
5.  **Close Connection:** Properly close the connection when done.

.File: `index.js` (Conceptual JavaScript Example)
[source,javascript]
----
const { createClient, LiveTranscriptionEvents } = require("@deepgram/sdk");
const fetch = require("cross-fetch");
require("dotenv").config();

const apiKey = process.env.DEEPGRAM_API_KEY;
const streamUrl = "http://stream.live.vc.bbcmedia.co.uk/bbc_world_service"; // Example stream

const transcribe = async () => {
  const deepgram = createClient(apiKey);

  const connection = deepgram.listen.live({
    model: "nova-2", 
    language: "en-US",
    smart_format: true,
  });

  connection.on(LiveTranscriptionEvents.Open, () => {
    console.log("Connection opened.");

    connection.on(LiveTranscriptionEvents.Transcript, (data) => {
      const transcript = data.channel.alternatives[0].transcript;
      if (transcript) {
        console.log(transcript);
      }
    });

    connection.on(LiveTranscriptionEvents.Metadata, (data) => {
      console.log("Metadata:", data);
    });

    connection.on(LiveTranscriptionEvents.Error, (err) => {
      console.error("Error:", err);
    });

    connection.on(LiveTranscriptionEvents.Close, () => {
      console.log("Connection closed.");
    });

    // Fetch and stream audio data
    fetch(streamUrl)
      .then((r) => r.body)
      .then((res) => {
        res.on("readable", () => {
          const chunk = res.read();
          if (chunk) {
            connection.send(chunk);
          }
        });
        res.on("end", () => {
          console.log("Audio stream ended.");
          connection.finish(); // Signal end of audio
        });
      })
      .catch((err) => {
         console.error("Error fetching stream:", err);
         connection.finish();
      });
  });
};

transcribe();
----

.File: `main.py` (Conceptual Python Example)
[source,python]
----
import os
import asyncio
import aiohttp
from dotenv import load_dotenv
from deepgram import ( DeepgramClient, DeepgramClientOptions, LiveTranscriptionEvents, LiveOptions,)

load_dotenv()

API_KEY = os.getenv("DEEPGRAM_API_KEY")
URL = "http://stream.live.vc.bbcmedia.co.uk/bbc_world_service" # Example Stream

async def main():
    config: DeepgramClientOptions = DeepgramClientOptions(
        verbose=logging.DEBUG, # Optional logging
        # options = ["keepalive=true"] # Example option
    )
    deepgram: DeepgramClient = DeepgramClient(API_KEY, config)

    try:
        dg_connection = deepgram.listen.asynclive.v("1")

        async def on_message(self, result, **kwargs):
            sentence = result.channel.alternatives[0].transcript
            if len(sentence) > 0:
                print(f"speaker: {sentence}")

        async def on_metadata(self, metadata, **kwargs):
            print(f"\nMetadata: {metadata}\n")

        async def on_speech_started(self, speech_started, **kwargs):
            print(f"\nSpeech Started\n")

        async def on_utterance_end(self, utterance_end, **kwargs):
            print(f"\nUtterance Ended\n")

        async def on_error(self, error, **kwargs):
            print(f"\nError: {error}\n")

        dg_connection.on(LiveTranscriptionEvents.Transcript, on_message)
        dg_connection.on(LiveTranscriptionEvents.Metadata, on_metadata)
        dg_connection.on(LiveTranscriptionEvents.SpeechStarted, on_speech_started)
        dg_connection.on(LiveTranscriptionEvents.UtteranceEnd, on_utterance_end)
        dg_connection.on(LiveTranscriptionEvents.Error, on_error)

        options: LiveOptions = LiveOptions(
            model="nova-2", language="en-US", smart_format=True
        )

        await dg_connection.start(options)

        # Send streaming audio from the URL
        async with aiohttp.ClientSession() as session:
            async with session.get(URL) as audio:
                while True:
                    data = await audio.content.readany()
                    if not data:
                        break
                    await dg_connection.send(data)

        # Indicate that we've finished sending data
        await dg_connection.finish()

    except Exception as e:
        print(f"Could not open socket: {e}")
        return

asyncio.run(main())
----

(C# and Go examples are also available in the documentation).

== Non-SDK usage

The documentation mentions a separate GitHub repository for code samples that do not use the official SDKs: [https://github.com/deepgram-devs/code-samples](https://github.com/deepgram-devs/code-samples)

== Results

*   Run your application (e.g., `node index.js` or `python main.py`).
*   Transcripts will typically be printed to the console based on the event listeners.
*   **Important:** Deepgram does not store transcripts. You must save the results from the API response or use a callback URL.

== Response analysis

The `Transcript` event provides data typically in JSON format. Key fields include:

*   `type`: Indicates the message type (e.g., "Results").
*   `channel_index`: Identifies the audio channel.
*   `duration`: Length of the processed audio segment (in seconds).
*   `start`: Start time of the segment relative to the beginning of the stream.
*   `is_final`: `true` if this is the final transcript for a segment, `false` for interim results.
*   `speech_final`: `true` if Deepgram detects this as the end of a natural speech segment (used for endpointing).
*   `channel.alternatives`: An array of transcription possibilities.
    *   `transcript`: The transcribed text.
    *   `confidence`: Overall confidence score (0-1) for the transcript.
    *   `words`: An array of word objects, each with:
        *   `word`: The specific word.
        *   `start`: Word start time.
        *   `end`: Word end time.
        *   `confidence`: Word-level confidence.
        *   `punctuated_word`: The word with punctuation/casing (if `smart_format` is enabled).
*   `metadata`: Information like `request_id`, `model_info`, etc.

== Key features (mentioned)

*   **Models:** Use different models like "nova-2" or "base" via the `model` parameter.
*   **Smart formatting:** Automatically formats dates, times, currencies, etc. (`smart_format=true`).
*   **Endpointing:** Detects natural pauses in speech to finalize transcripts (`speech_final`). See [Endpointing Documentation](https://developers.deepgram.com/docs/endpointing/).
*   **Interim results:** Get faster, potentially less accurate results while Deepgram continues processing (`is_final=false`). See [Interim Results Documentation](https://developers.deepgram.com/docs/interim-results/).
*   **KeepAlive:** Send messages to keep the WebSocket connection open during long silences. See [KeepAlive Documentation](https://developers.deepgram.com/docs/keep-alive).
*   **Language:** Specify the language of the audio (`language` parameter). See [Language Documentation](https://developers.deepgram.com/docs/language).

== What's next (from docs)

*   Explore Starter Apps: [Live Audio Starter Apps](https://developers.deepgram.com/docs/starter-apps)
*   Review Feature Guides: [Streaming Feature Overview](https://developers.deepgram.com/docs/stt-streaming-feature-overview)
*   Check the API Reference: [Live Streaming API Reference](https://developers.deepgram.com/reference/streaming)
*   Learn about audio formats: [Determining Your Audio Format](https://developers.deepgram.com/docs/determining-your-audio-format-for-live-streaming-audio/)
*   Transcribe pre-recorded audio: [Getting Started with Pre-recorded Audio](https://developers.deepgram.com/docs/getting-started-with-pre-recorded-audio/) 