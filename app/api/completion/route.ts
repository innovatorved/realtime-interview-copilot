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
  streamFromGoogleAI(prompt, writer, encoder).catch(async (error) => {
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

import { GoogleGenerativeAI } from "@google/generative-ai";

async function streamFromGoogleAI(
  prompt: string,
  writer: WritableStreamDefaultWriter<Uint8Array>,
  encoder: TextEncoder,
) {
  const API_KEY = process.env.GOOGLE_GENERATIVE_AI_API_KEY!;
  const MODEL_NAME = "gemini-2.0-flash-lite"; // Or another streaming-supported model

  const genAI = new GoogleGenerativeAI(API_KEY);
  const model = genAI.getGenerativeModel({ model: MODEL_NAME });

  try {
    const result = await model.generateContentStream(prompt);

    for await (const chunk of result.stream) {
      const text = chunk.text();
      if (text) {
        const sseData = JSON.stringify({ text });
        console.log(sseData);
        await writer.write(encoder.encode(`data: ${sseData}\n\n`));
      }
    }

    await writer.write(encoder.encode("data: [DONE]\n\n"));
  } catch (error: any) {
    console.error("Error streaming from Gemini API:", error);
    const errorMessage = JSON.stringify({ error: error.message });
    await writer.write(encoder.encode(`data: ${errorMessage}\n\n`));
  } finally {
    await writer.close();
  }
}
