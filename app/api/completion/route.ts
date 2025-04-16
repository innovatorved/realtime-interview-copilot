import { FLAGS } from "@/lib/types";
import { buildPrompt, buildSummerizerPrompt } from "@/lib/utils";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { streamText } from "ai";

const google = createGoogleGenerativeAI({});
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

  const result = streamText({
    model: google("gemini-2.0-flash-lite"),
    messages: [
      {
        role: "user",
        content: prompt,
      },
    ],
  });

  return result.toDataStreamResponse();
}
