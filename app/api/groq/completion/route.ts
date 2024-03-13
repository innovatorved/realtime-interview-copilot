import groq from "@/lib/groq";
import { FLAGS } from "@/lib/types";
import { buildPrompt, buildSummerizerPrompt } from "@/lib/utils";
import { OpenAIStream, StreamingTextResponse } from "ai";

export const runtime = "edge";
const GROK_MODEL = "mixtral-8x7b-32768";

export async function POST(req: Request) {
  const { bg, flag, prompt: transcribe } = await req.json();

  let prompt = transcribe;
  if (flag === FLAGS.COPILOT) {
    prompt = buildPrompt(bg, transcribe);
  } else if (flag === FLAGS.SUMMERIZER) {
    prompt = buildSummerizerPrompt(transcribe);
  }

  const response = await groq.completions.create({
    model: GROK_MODEL,
    max_tokens: 2000,
    stream: true,
    prompt: prompt,
  });

  const stream = OpenAIStream(response);
  return new StreamingTextResponse(stream);
}
