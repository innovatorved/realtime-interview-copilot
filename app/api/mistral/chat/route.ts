import mistral from "@/lib/mistral";
import { MistralStream, StreamingTextResponse } from "ai";

export async function POST(req: Request) {
  const { messages } = await req.json();
  const response = mistral.chatStream({
    model: "mistral-small",
    maxTokens: 1000,
    messages,
  });

  const stream = MistralStream(response);
  return new StreamingTextResponse(stream);
}
