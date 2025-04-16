import { FLAGS } from "@/lib/types";
import { buildPrompt, buildSummerizerPrompt } from "@/lib/utils";
import { StreamingTextResponse } from "ai";
import logger from "@/lib/logger";

// Validate required environment variables
const requiredEnvVars = [
  "OPENAI_API_KEY",
  "OPENAI_BASE_URL",
  "SITE_BASE_URL",
  "PORT",
  "APP_NAME",
  "MODEL",
];
const missingEnvVars: string[] = [];
requiredEnvVars.forEach((key) => {
  if (!process.env[key]) {
    missingEnvVars.push(key);
  }
});
if (missingEnvVars.length > 0) {
  logger.error(`Missing required environment variables: ${missingEnvVars.join(", ")}`);
}

// Define default models - static fallback if can't import JSON
const DEFAULT_MODELS = {
  defaultModel: "openai/gpt-4o-mini",
  availableModels: [
    "openai/gpt-4o-mini",
    "openai/gpt-4o",
    "anthropic/claude-3-haiku",
    "anthropic/claude-3-sonnet",
    "google/gemini-flash-1.5",
    "google/gemini-pro-1.5"
  ]
};

// Model default fallback; other vars must be provided via env
const DEFAULT_MODEL_FROM_ENV = process.env.MODEL!;
const API_KEY = process.env.OPENAI_API_KEY!;
const BASE_URL = process.env.OPENAI_BASE_URL!;
// Construct full site URL from base and port
const SITE_BASE_URL = process.env.SITE_BASE_URL!;
const PORT = process.env.PORT!;
const SITE_URL = `${SITE_BASE_URL}:${PORT}`;
const APP_NAME = process.env.APP_NAME!;

// Define a more appropriate type for headers
type RequestHeaders = Record<string, string>;

export async function POST(req: Request) {
  // Abort if required environment variables are missing
  if (missingEnvVars.length > 0) {
    return new Response(
      JSON.stringify({ error: `Server misconfiguration: missing env vars: ${missingEnvVars.join(", ")}` }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }
    );
  }
  logger.info("Received request for AI completion.");

  try {
    // Destructure model from the request body, provide default from ENV
    const { bg, flag, prompt: transcribe, model: requestedModel } = await req.json();
    
    // Determine the model to use: request body > ENV variable
    const modelToUse = requestedModel || DEFAULT_MODEL_FROM_ENV; 
    
    logger.info(`Received flag: ${flag}, background length: ${bg?.length}, transcribe length: ${transcribe?.length}, requested model: ${requestedModel || 'N/A'}, using model: ${modelToUse}`);

    let finalPrompt = transcribe;
    if (flag === FLAGS.COPILOT) {
      finalPrompt = buildPrompt(bg, transcribe);
      logger.info("Built prompt for Copilot mode.");
    } else if (flag === FLAGS.SUMMERIZER) {
      finalPrompt = buildSummerizerPrompt(transcribe);
      logger.info("Built prompt for Summarizer mode.");
    } else {
      logger.warn(`Unknown flag received: ${flag}. Using raw transcription as prompt.`);
    }

    // Prepare payload using the determined model
    const requestPayload = {
      model: modelToUse, // Use the determined model
      max_tokens: 2000,
      stream: true,
      messages: [
        {
          role: "user",
          content: finalPrompt,
        },
      ],
    };

    // Log the request payload with the actual model being used
    logger.info(`Sending request to AI model ${modelToUse} with payload:`);
    logger.info("Payload log attempted.");
    
    // Use BASE_URL from environment variables
    const isOpenRouter = BASE_URL.includes("openrouter");
    // Construct the API endpoint URL using the base URL from environment
    const apiUrl = `${BASE_URL}/chat/completions`;
    
    logger.info(`Using API URL: ${apiUrl}`);
    
    // Construct headers based on OpenRouter documentation
    const headers: RequestHeaders = {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${API_KEY}`
    };
    
    // Add OpenRouter specific headers if needed
    if (isOpenRouter) {
      if (SITE_URL) headers["HTTP-Referer"] = SITE_URL;
      if (APP_NAME) headers["X-Title"] = APP_NAME;
    }
    
    // **** Add log to verify API Key at runtime ****
    logger.info(`API Key used in fetch: ${API_KEY ? API_KEY.substring(0, 10) + "..." : "MISSING"}`);
    
    logger.info(`Request headers: ${JSON.stringify(headers)}`);
    
    // +++ START Detailed Request Logging +++
    logger.info(`--- Preparing Fetch Request ---`);
    logger.info(`Method: POST`);
    logger.info(`URL: ${apiUrl}`);
    logger.info(`Full Headers: ${JSON.stringify(headers, null, 2)}`); // Log full headers
    logger.info(`Full Body Payload: ${JSON.stringify(requestPayload, null, 2)}`); // Log full payload
    logger.info(`--- End Fetch Request Details ---`);
    // +++ END Detailed Request Logging +++

    // Make direct fetch request
    const response = await fetch(apiUrl, {
      method: "POST",
      headers: headers,
      body: JSON.stringify(requestPayload),
    });
    
    // Check if the response is OK
    if (!response.ok) {
      const errorText = await response.text();
      logger.error(`API Error: ${response.status} ${response.statusText}`);
      logger.error(`Response body: ${errorText}`);
      throw new Error(`API request failed with status ${response.status}: ${errorText}`);
    }
    
    logger.info("Received successful response from AI service. Streaming back to client.");
    
    // Return the streaming response directly
    return new Response(response.body, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
      },
    });
  } catch (error: any) {
    // Log the error details safely
    logger.error("Error details in completion route:");
    logger.error(`- Message: ${error.message}`);
    logger.error(`- Status: ${error.status}`);
    try {
      if (error.headers) logger.error(`- Headers: ${JSON.stringify(error.headers)}`);
      if (error.error) logger.error(`- Error Body: ${JSON.stringify(error.error)}`);
    } catch (stringifyError) {
      logger.error("- Headers/Body: Could not stringify error details.");
    }

    // Return appropriate error response
    return new Response(
      JSON.stringify({ error: error.message || "Internal Server Error" }), 
      {
        status: error.status || 500,
        headers: { "Content-Type": "application/json" },
      }
    );
  }
}
