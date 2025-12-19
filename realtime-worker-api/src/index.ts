import { auth } from "./auth";

enum FLAGS {
  COPILOT = "copilot",
  SUMMERIZER = "summerizer",
}

interface Env {
  DEEPGRAM_API_KEY: string;
  GOOGLE_GENERATIVE_AI_API_KEY: string;
  GEMINI_MODEL?: string;
  BETTER_AUTH_SECRET: string;
  BETTER_AUTH_URL: string;
  DB: D1Database;
}

interface CompletionRequestBody {
  bg?: string;
  flag?: string;
  prompt?: string;
}

interface WorkerExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException?(): void;
}

const jsonHeaders = {
  "content-type": "application/json",
};

const encoder = new TextEncoder();

const ALLOWED_METHODS = "GET,POST,OPTIONS";
const ALLOWED_HEADERS = "Content-Type,Authorization";
const CORS_MAX_AGE = "86400";

function buildCorsHeaders(request: Request) {
  const origin = request.headers.get("Origin");
  const allowOrigin = origin ?? "*";

  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Methods": ALLOWED_METHODS,
    "Access-Control-Allow-Headers": ALLOWED_HEADERS,
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Max-Age": CORS_MAX_AGE,
    Vary: "Origin",
  } satisfies Record<string, string>;
}

function withCors(response: Response, request: Request): Response {
  const corsHeaders = buildCorsHeaders(request);
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(corsHeaders)) {
    headers.set(key, value);
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function handleOptions(request: Request): Response {
  const headers = buildCorsHeaders(request);
  return new Response(null, {
    status: 200,
    headers,
  });
}

function buildPrompt(bg: string | undefined, conversation: string) {
  return `You are an expert interview assistant designed to help the candidate succeed. Your goal is to generate a comprehensive, structured, and natural-sounding response that the candidate can confidently speak during the interview.

**Instructions:**
1.  **Analyze the Context:** Use the provided background information and conversation history to understand the interviewer's question and the current topic.
2.  **Structure the Response:**
    *   **Direct Answer:** Start with a clear, direct answer to the question.
    *   **Key Points:** Provide 3-5 detailed bullet points explaining the concept, methodology, or reasoning. Use professional terminology but keep the explanations accessible.
    *   **Example/Experience:** If applicable, briefly suggest a relevant example or a way to tie this back to practical experience.
3.  **Tone & Style:**
    *   Professional, confident, and articulate.
    *   "Speakable": Write in a way that sounds natural when spoken aloud. Avoid overly complex sentence structures or unpronounceable jargon unless standard in the field.
    *   Avoid meta-commentary (e.g., "Here is a response..."). Just provide the content.
4.  **Detail Level:** Be detailed and sufficient. Do not be brief unless the question demands a simple yes/no. Ensure the candidate has enough material to speak for 1-2 minutes if needed.

**Input Data:**
--------------------------------
BACKGROUND:
${bg}
--------------------------------
CONVERSATION:
${conversation}
--------------------------------

**Response:**`;
}

function buildSummerizerPrompt(text: string) {
  return `You are a summerizer. You are summarizing the given text. Summarize the following text. Only write summary.\nContent:\n${text}\nSummary:\n`;
}

type DeepgramProjectsResponse = {
  projects: Array<{ project_id: string }>;
};

type DeepgramKeyResponse = Record<string, unknown> & {
  error?: unknown;
};

const badFinishReasons = [
  "SAFETY",
  "RECITATION",
  "LANGUAGE",
  "BLOCKLIST",
  "PROHIBITED_CONTENT",
  "SPII",
  "MALFORMED_FUNCTION_CALL",
];

export default {
  async fetch(
    request: Request,
    env: Env,
    ctx: WorkerExecutionContext,
  ): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/$/, "");

    console.log(`[Worker] Incoming request: ${request.method} ${path}`);

    if (request.method === "OPTIONS") {
      return handleOptions(request);
    }

    if (
      (request.method === "POST" || request.method === "GET") &&
      (path === "/api/deepgram" || path === "/deepgram")
    ) {
      const response = await handleDeepgram(env);
      return withCors(response, request);
    }

    if (
      request.method === "POST" &&
      (path === "/api/completion" || path === "/completion")
    ) {
      const response = await handleCompletion(request, env, ctx);
      return withCors(response, request);
    }

    if (path.startsWith("/api/auth")) {
      console.log("[Worker] Handling auth request");
      try {
        const response = await auth(env).handler(request);
        console.log(`[Worker] Auth response status: ${response.status}`);
        return withCors(response, request);
      } catch (e) {
        console.error("[Worker] Auth error:", e);
        return withCors(
          new Response(JSON.stringify({ error: String(e) }), {
            status: 500,
            headers: jsonHeaders,
          }),
          request,
        );
      }
    }

    return withCors(
      new Response(JSON.stringify({ error: "Not found" }), {
        status: 404,
        headers: jsonHeaders,
      }),
      request,
    );
  },
};

async function handleDeepgram(env: Env): Promise<Response> {
  const apiKey = env.DEEPGRAM_API_KEY;

  if (!apiKey) {
    return new Response(
      JSON.stringify({ error: "Missing DEEPGRAM_API_KEY binding" }),
      {
        status: 500,
        headers: jsonHeaders,
      },
    );
  }

  const authHeaders = {
    Authorization: `Token ${apiKey}`,
    accept: "application/json",
  };

  const projectsResponse = await fetch("https://api.deepgram.com/v1/projects", {
    method: "GET",
    headers: authHeaders,
  });

  const projectsBody =
    (await projectsResponse.json()) as DeepgramProjectsResponse;

  if (!projectsResponse.ok) {
    return new Response(JSON.stringify(projectsBody), {
      status: projectsResponse.status,
      headers: jsonHeaders,
    });
  }

  const project = projectsBody.projects?.[0];

  if (!project) {
    return new Response(
      JSON.stringify({
        error: "Cannot find a Deepgram project. Please create a project first.",
      }),
      {
        status: 404,
        headers: jsonHeaders,
      },
    );
  }

  const createResponse = await fetch(
    `https://api.deepgram.com/v1/projects/${project.project_id}/keys`,
    {
      method: "POST",
      headers: {
        ...authHeaders,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        comment: "Temporary API key",
        scopes: ["usage:write"],
        tags: ["cloudflare-worker"],
        time_to_live_in_seconds: 60,
      }),
    },
  );

  const createBody = (await createResponse.json()) as DeepgramKeyResponse;

  return new Response(JSON.stringify(createBody), {
    status: createResponse.ok ? 200 : createResponse.status,
    headers: jsonHeaders,
  });
}

async function handleCompletion(
  request: Request,
  env: Env,
  ctx: WorkerExecutionContext,
): Promise<Response> {
  let payload: CompletionRequestBody;
  try {
    payload = (await request.json()) as CompletionRequestBody;
  } catch (error) {
    return new Response(JSON.stringify({ error: "Invalid JSON payload" }), {
      status: 400,
      headers: jsonHeaders,
    });
  }

  const basePrompt = (payload?.prompt ?? "").trim();

  if (!basePrompt) {
    return new Response(JSON.stringify({ error: "prompt is required" }), {
      status: 400,
      headers: jsonHeaders,
    });
  }

  let finalPrompt = basePrompt;
  if (payload.flag === FLAGS.COPILOT) {
    finalPrompt = buildPrompt(payload.bg, basePrompt);
  } else if (payload.flag === FLAGS.SUMMERIZER) {
    finalPrompt = buildSummerizerPrompt(basePrompt);
  }

  const stream = new TransformStream();
  const writer = stream.writable.getWriter();

  const pump = streamGeminiCompletion(finalPrompt, env, writer)
    .catch(async (error: unknown) => {
      const message =
        error instanceof Error
          ? { error: error.message }
          : { error: String(error) };
      await writer.write(
        encoder.encode(`data: ${JSON.stringify(message)}\n\n`),
      );
    })
    .finally(async () => {
      await writer.close();
    });

  ctx.waitUntil(pump);

  return new Response(stream.readable, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}

async function streamGeminiCompletion(
  prompt: string,
  env: Env,
  writer: WritableStreamDefaultWriter<Uint8Array>,
) {
  const apiKey = env.GOOGLE_GENERATIVE_AI_API_KEY;
  if (!apiKey) {
    throw new Error("Missing GOOGLE_GENERATIVE_AI_API_KEY binding");
  }

  const DEFAULT_MODEL = "gemini-3-flash-preview";
  const modelName = env.GEMINI_MODEL || DEFAULT_MODEL;
  const url = `https://gateway.ai.cloudflare.com/v1/b4ca0337fb21e846c53e1f2611ba436c/gateway04/google-ai-studio/v1beta/models/${modelName}:streamGenerateContent?alt=sse&key=${apiKey}`;

  const requestBody = JSON.stringify({
    contents: [
      {
        parts: [{ text: prompt }],
        role: "user",
      },
    ],
    generationConfig: {
      maxOutputTokens: 8192,
    },
  });

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: requestBody,
    });

    if (!response.ok) {
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
  }
}

async function processSSEMessage(
  rawMessage: string,
  writer: WritableStreamDefaultWriter<Uint8Array>,
): Promise<boolean> {
  if (!rawMessage.trim()) {
    return false;
  }

  // Extract data: prefix
  const dataMatch = rawMessage.match(/^data:\s*(.*)$/m);
  if (!dataMatch) {
    return false;
  }

  const dataContent = dataMatch[1].trim();

  if (!dataContent) {
    return false;
  }

  if (dataContent === "[DONE]") {
    await writer.write(encoder.encode("data: [DONE]\n\n"));
    return true;
  }

  try {
    const chunk = JSON.parse(dataContent);
    const text = extractTextFromChunk(chunk);
    if (text) {
      await writer.write(
        encoder.encode(`data: ${JSON.stringify({ text })}\n\n`),
      );
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("Failed to parse chunk:", dataContent, message);
    await writer.write(
      encoder.encode(
        `data: ${JSON.stringify({ error: `JSON parse error: ${message}` })}\n\n`,
      ),
    );
  }

  return false;
}

function extractTextFromChunk(chunk: any): string | null {
  if (!chunk) {
    return null;
  }

  const feedback = chunk.promptFeedback;
  if (feedback?.blockReason) {
    return `[PROMPT_BLOCKED: ${feedback.blockReason}]`;
  }

  const candidate = chunk.candidates?.[0];
  if (!candidate) {
    return null;
  }

  if (
    candidate.finishReason &&
    badFinishReasons.includes(candidate.finishReason)
  ) {
    return `[CANDIDATE_BLOCKED: ${candidate.finishReason}]`;
  }

  const parts = candidate.content?.parts;
  if (!Array.isArray(parts) || parts.length === 0) {
    return null;
  }

  let text = "";
  for (const part of parts) {
    if (typeof part?.text === "string") {
      text += part.text;
    }
  }

  return text || null;
}
