import OpenAI from "openai";

const API_KEY= process.env.OPENAI_API_KEY!;
const BASE_URL = process.env.OPENAI_BASE_URL!;

const openai = new OpenAI({
  apiKey: API_KEY,
  baseURL: BASE_URL,
});

export default openai;
