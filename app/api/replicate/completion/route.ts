import replicate from "@/lib/replicate";
import { ReplicateStream, StreamingTextResponse } from "ai";

const MODEL_ID =
  "79052a3adbba8116ebc6697dcba67ad0d58feff23e7aeb2f103fc9aa545f9269";

export async function POST(req: Request) {
  const data = await req.json();
  const response = await replicate.predictions.create({
    stream: true,
    version: MODEL_ID,
    input: {
      prompt: data.prompt,
    },
  });

  const stream = await ReplicateStream(response);
  return new StreamingTextResponse(stream);
}
