import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function buildPrompt(bg: string | undefined, conversation: string) {
  return `You are a interview co-pilot. You are assisting in writing responses to the interviewee's answers. You have access to the interview conversation and the background information for the interview. Write a direct response to the interviewee's question, without including any information about yourself. Create Short Response and donot create background and conversation.
--------------------------------
BACKGROUND: ${bg}
--------------------------------
CONVERSATION: ${conversation}
--------------------------------
Response:`;
}

export function buildSummerizerPrompt(text: string) {
  return `You are a summerizer. You are summarizing the given text. Summarize the following text. Only write summary.
${text}
Summary:
`;
}
