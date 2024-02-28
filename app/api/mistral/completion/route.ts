import mistral from "@/lib/mistral";
import { MistralStream, StreamingTextResponse } from "ai";

export const runtime = "edge";

export async function POST(req: Request) {
  const { prompt } = await req.json();
  const response = mistral.chatStream({
    model: "mistral-small",
    maxTokens: 1000,
    messages: [{ role: "user", content: prompt }],
  });

  const stream = MistralStream(response);

  return new StreamingTextResponse(stream);
}
