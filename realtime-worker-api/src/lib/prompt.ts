export function buildPrompt(bg: string | undefined, conversation: string) {
  return `You are an interview coach. Given the background and conversation below, craft a spoken response the candidate can deliver confidently.

Rules:
- Open with a direct answer, then support it with 3–5 concise points
- Use field-appropriate terminology; write how people speak, not how they type
- Close with a brief real-world example or hands-on tie-in when relevant
- No meta-text ("Here's a response…") — just the answer itself
- Aim for ~1–2 minutes of speaking material

BACKGROUND: ${bg ?? "None provided"}

CONVERSATION:
${conversation}

RESPONSE:`;
}

export function buildSummarizerPrompt(text: string) {
  return `Summarize concisely. Output only the summary.

${text}`;
}