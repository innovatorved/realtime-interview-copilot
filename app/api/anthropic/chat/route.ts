import anthropic from "@/lib/anthropic";
import { AnthropicStream, StreamingTextResponse } from "ai";

export const runtime = "edge";

export async function POST(req: Request) {
  const { messages } = await req.json();
  const response = await anthropic.messages.create({
    messages,
    model: "claude-2.1",
    stream: true,
    max_tokens: 300,
  });

  const stream = AnthropicStream(response);
  return new StreamingTextResponse(stream);
}
