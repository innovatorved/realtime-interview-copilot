import OpenAI from "openai";

const grok = new OpenAI({
  apiKey: process.env.GROQ_API_KEY || "",
  baseURL: "https://api.groq.com/",

});

export default grok;
