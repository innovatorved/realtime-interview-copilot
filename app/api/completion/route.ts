import openai from "@/lib/openai";
import { FLAGS } from "@/lib/types";
import { buildPrompt, buildSummerizerPrompt } from "@/lib/utils";
import { OpenAIStream, StreamingTextResponse } from "ai";

export const runtime = "edge";
const MODEL = process.env.MODEL || "gpt-3.5-turbo-instruct";

export async function POST(req: Request) {
  const { bg, flag, prompt: transcribe } = await req.json();

  let prompt = transcribe;
  if (flag === FLAGS.COPILOT) {
    prompt = buildPrompt(bg, transcribe);
  } else if (flag === FLAGS.SUMMERIZER) {
    prompt = buildSummerizerPrompt(transcribe);
  }

  const response = await openai.chat.completions.create({
    model: MODEL,
    max_tokens: 2000,
    stream: true,
    messages: [
      {
        role: "user",
        content: prompt,
      },
    ],
  });

  const stream = OpenAIStream(response);
  return new StreamingTextResponse(stream);
}
