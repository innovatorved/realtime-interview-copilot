import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function buildPrompt(bg: string | undefined, conversation: string) {
  return `You are a interview co-pilot. You are assisting in writing responses to the interviewee's answers. You have access to the interview conversation and the background information for the interview. Write a direct response to the interviewee's question, without including any information about yourself. Create Short Response and donot create background and conversation. **IMPORTANT: Respond ONLY in English.**

**Code Examples:** If the question involves code, algorithms, or technical details, include relevant code examples where applicable. Use Python for examples unless PHP is explicitly mentioned or requested in the conversation or background, in which case use PHP examples.
--------------------------------
BACKGROUND: ${bg}
--------------------------------
CONVERSATION: ${conversation}
--------------------------------
Response:`;
}

export function buildSummerizerPrompt(text: string) {
  return `You are a summerizer. You are summarizing the given text. Summarize the following text. Only write summary. **IMPORTANT: Respond ONLY in English.**
Content:
${text}
Summary:
`;
}
