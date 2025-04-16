import OpenAI from "openai";

// Determine if we are using OpenRouter
const isOpenRouter = process.env.OPENAI_BASE_URL?.includes("openrouter");

// Create OpenAI instance following exactly the OpenRouter documentation format
const openai = new OpenAI({
  baseURL: isOpenRouter ? 'https://openrouter.ai/api/v1' : 'https://api.openai.com/v1',
  apiKey: process.env.OPENAI_API_KEY || "", 
  defaultHeaders: isOpenRouter 
    ? {
        'HTTP-Referer': process.env.SITE_URL || '',
        'X-Title': process.env.APP_NAME || '',
      } 
    : undefined,
  dangerouslyAllowBrowser: true,
});

export default openai;
