import { FLAGS } from "@/lib/types";
import { buildPrompt, buildSummerizerPrompt } from "@/lib/utils";

export const runtime = "edge";

export async function POST(req: Request) {
  const {
    bg,
    flag,
    prompt: transcribe,
  } = (await req.json()) as {
    bg: string;
    flag: string;
    prompt: string;
  };

  let prompt = transcribe;
  if (flag === FLAGS.COPILOT) {
    prompt = buildPrompt(bg, transcribe);
  } else if (flag === FLAGS.SUMMERIZER) {
    prompt = buildSummerizerPrompt(transcribe);
  }

  // Create streaming response
  const stream = new TransformStream();
  const writer = stream.writable.getWriter();
  const encoder = new TextEncoder();

  // Start the fetch in the background
  // Fix for error "XMLHttpRequest is not defined": Remove usage of GoogleGenerativeAI SDK and rely solely on fetch
  streamDirectlyWithFetch(prompt, writer, encoder).catch(async (error) => {
    const errorMessage = JSON.stringify({ error: error.message });
    await writer.write(encoder.encode(`data: ${errorMessage}\n\n`));
    await writer.close();
  });

  return new Response(stream.readable, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}

// Helper function to extract text from a Gemini API stream chunk JSON
// Based on the SDK's internal logic (addHelpers/getText)
function extractTextFromChunk(chunk: any): string | null {
  if (!chunk) {
    return null;
  }

  // Handle potential errors or blocks indicated in the chunk
  if (chunk.promptFeedback) {
    console.warn("Prompt Feedback received:", chunk.promptFeedback);
    // You might want to signal this differently, e.g., throw an error or send a specific SSE event
    if (chunk.promptFeedback.blockReason) {
      return `[PROMPT_BLOCKED: ${chunk.promptFeedback.blockReason}]`;
    }
  }

  if (chunk.candidates && chunk.candidates.length > 0) {
    const candidate = chunk.candidates[0];

    // Check for candidate blocking/finish reasons if needed
    const badFinishReasons = [
      "SAFETY",
      "RECITATION",
      "LANGUAGE",
      "BLOCKLIST",
      "PROHIBITED_CONTENT",
      "SPII",
      // "MALFORMED_FUNCTION_CALL" // Only relevant if using function calling
    ];
    if (
      candidate.finishReason &&
      badFinishReasons.includes(candidate.finishReason)
    ) {
      console.warn(
        `Candidate blocked or finished due to: ${candidate.finishReason}`,
      );
      // You might want to signal this differently
      return `[CANDIDATE_BLOCKED: ${candidate.finishReason}]`;
    }

    if (
      candidate.content &&
      candidate.content.parts &&
      candidate.content.parts.length > 0
    ) {
      let text = "";
      for (const part of candidate.content.parts) {
        if (part.text) {
          text += part.text;
        }
        // Add handling for other part types like executableCode if needed
        // if (part.executableCode) { ... }
        // if (part.codeExecutionResult) { ... }
      }
      return text;
    }
  }

  return null; // No text found in this chunk
}

// Your modified function using direct fetch
async function streamDirectlyWithFetch(
  prompt: string,
  writer: WritableStreamDefaultWriter<Uint8Array>,
  encoder: TextEncoder,
) {
  const API_KEY = process.env.GOOGLE_GENERATIVE_AI_API_KEY!;
  if (!API_KEY) {
    throw new Error(
      "Missing GOOGLE_GENERATIVE_AI_API_KEY environment variable",
    );
  }
  const MODEL_NAME = "gemini-2.0-flash-lite"; // Use a known stable or desired model
  // Or use a specific model you have access to like "gemini-pro"

  // const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL_NAME}:streamGenerateContent?alt=sse&key=${API_KEY}`;
  const url = `https://gateway.ai.cloudflare.com/v1/b4ca0337fb21e846c53e1f2611ba436c/gateway04/google-ai-studio/v1beta/models/${MODEL_NAME}:streamGenerateContent?alt=sse&key=${API_KEY}`;

  // Construct the request body - adjust safetySettings/generationConfig as needed
  const requestBody = JSON.stringify({
    contents: [
      {
        parts: [{ text: prompt }],
        role: "user", // Usually 'user' for the first message
      },
    ],
    // Add safety settings or generation config if needed
    // safetySettings: [
    //   { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" },
    //   // ... other settings
    // ],
    // generationConfig: {
    //   temperature: 0.7,
    //   // ... other config
    // }
  });

  // console.log(
  //   "Streaming URL:",
  //   `https://generativelanguage.googleapis.com/v1beta/models/${MODEL_NAME}:streamGenerateContent?alt=sse&key=...`,
  // ); // Log URL without key
  // console.log("Request Body:", requestBody);

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        // Add custom headers via requestOptions if needed, like 'x-goog-api-client'
      },
      body: requestBody,
      // signal/timeout if needed, e.g., using AbortController
      // signal: controller.signal
    });

    console.log("Fetch Response Status:", response.status);

    if (!response.ok) {
      // Attempt to read error details from the response body
      let errorBody = "Could not read error body";
      try {
        errorBody = await response.text();
        console.error("API Error Body:", errorBody);
      } catch (readError) {
        console.error("Failed to read error body:", readError);
      }
      throw new Error(
        `API Error: ${response.status} ${response.statusText}. Body: ${errorBody}`,
      );
    }

    if (!response.body) {
      throw new Error("Response body is null");
    }

    // Process the SSE stream
    const reader = response.body
      .pipeThrough(new TextDecoderStream()) // Decode Uint8Array to text
      .getReader();

    let buffer = "";
    const SSERegex = /^data:\s*(.*)(?:\n\n|\r\r|\r\n\r\n)/; // Regex to find "data: {...}\n\n"

    while (true) {
      const { done, value } = await reader.read();

      if (done) {
        console.log("Stream finished.");
        // Process any remaining data in the buffer (unlikely for valid SSE but good practice)
        if (buffer.trim()) {
          console.warn("Trailing data in buffer after stream end:", buffer);
          // You could try one last parse attempt here if necessary
        }
        break; // Exit the loop
      }

      buffer += value; // Append the new chunk to the buffer

      let match;
      // Process all complete SSE messages in the buffer
      while ((match = buffer.match(SSERegex)) !== null) {
        const jsonDataString = match[1];

        if (jsonDataString) {
          try {
            const jsonChunk = JSON.parse(jsonDataString);
            // console.log("Raw Chunk JSON:", JSON.stringify(jsonChunk, null, 2)); // Optional: Log the raw chunk

            const text = extractTextFromChunk(jsonChunk);

            if (text !== null && text !== "") {
              // Check for non-empty text
              const sseData = JSON.stringify({ text });
              console.log("Sending SSE Data:", sseData); // Your original log
              await writer.write(encoder.encode(`data: ${sseData}\n\n`));
            } else {
              // console.log("Chunk contained no text or was a non-text chunk."); // Optional: Log empty chunks
            }
          } catch (e: any) {
            console.error("Error parsing JSON chunk:", jsonDataString, e);
            // Send an error message downstream if parsing fails
            const errorMessage = JSON.stringify({
              error: `JSON Parse Error: ${e.message}`,
            });
            await writer.write(encoder.encode(`data: ${errorMessage}\n\n`));
          }
        }

        // Remove the processed message (including delimiters) from the buffer
        buffer = buffer.substring(match[0].length);
      }
    }

    // Send the final [DONE] marker
    await writer.write(encoder.encode("data: [DONE]\n\n"));
    console.log("Sent [DONE] marker.");
  } catch (error: any) {
    console.error("Error streaming directly from Gemini API:", error);
    // Ensure error is stringified correctly for SSE
    let errorMessageContent: any;
    if (error instanceof Error) {
      errorMessageContent = {
        name: error.name,
        message: error.message,
        stack: error.stack,
      }; // Include stack for debugging
    } else {
      errorMessageContent = { error: String(error) };
    }
    const errorMessage = JSON.stringify({ error: errorMessageContent });
    try {
      await writer.write(encoder.encode(`data: ${errorMessage}\n\n`));
    } catch (writeError) {
      console.error("Failed to write error message to stream:", writeError);
    }
  } finally {
    try {
      await writer.close();
      console.log("Writer closed.");
    } catch (closeError) {
      console.error("Failed to close writer:", closeError);
    }
  }
}
