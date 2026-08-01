import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_MODEL: z.string().default("gpt-5.6-sol"),
  OPENAI_REASONING_EFFORT: z
    .enum(["none", "low", "medium", "high", "xhigh", "max"])
    .default("medium"),
  PORT: z.coerce.number().int().positive().default(3000),
  MOCK_OPENAI: z
    .string()
    .default("false")
    .transform((value) => value.toLowerCase() === "true"),
});

const env = envSchema.parse(process.env);

export const config = {
  apiKey: env.OPENAI_API_KEY,
  model: env.OPENAI_MODEL,
  reasoningEffort: env.OPENAI_REASONING_EFFORT,
  port: env.PORT,
  mockMode: env.MOCK_OPENAI || !env.OPENAI_API_KEY,
};

