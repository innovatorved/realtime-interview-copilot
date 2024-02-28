import MistralClient from "@mistralai/mistralai";

const mistral = new MistralClient(process.env.MISTRAL_API_KEY || "");

export default mistral;
