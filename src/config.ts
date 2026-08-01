import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_MODEL: z.string().default("gpt-5.6-sol"),
  OPENAI_FAST_MODEL: z.string().default("gpt-5.6-luna"),
  OPENAI_QUALITY_MODEL: z.string().optional(),
  OPENAI_CRITIC_MODEL: z.string().optional(),
  OPENAI_REASONING_EFFORT: z
    .enum(["none", "low", "medium", "high", "xhigh", "max"])
    .default("low"),
  OPENAI_MAX_OUTPUT_TOKENS: z.coerce.number().int().min(1000).max(20_000).default(5000),
  AGENT_MAX_TOTAL_TOKENS: z.coerce.number().int().min(5000).max(100_000).default(20_000),
  AGENT_ARCHITECTURE: z.enum(["single", "team"]).default("team"),
  PORT: z.coerce.number().int().positive().default(3000),
  MOCK_OPENAI: z
    .string()
    .default("false")
    .transform((value) => value.toLowerCase() === "true"),
  XAI_API_KEY: z.string().optional(),
  GROK_MODEL: z.string().default("grok-4.5"),
  GROK_MAX_OUTPUT_TOKENS: z.coerce.number().int().min(200).max(3000).default(900),
  X_MAX_POSTS: z.coerce.number().int().min(2).max(8).default(6),
  X_SEARCH_CANDIDATES: z.coerce.number().int().min(4).max(24).default(10),
  REDDIT_ENABLED: z.string().default("true").transform((value) => value.toLowerCase() === "true"),
  REDDIT_USER_AGENT: z.string().default("DeckForgeX/0.1 community-research"),
  REDDIT_MAX_POSTS: z.coerce.number().int().min(2).max(8).default(6),
  REDDIT_SEARCH_CANDIDATES: z.coerce.number().int().min(4).max(24).default(12),
  REDDIT_TIMEOUT_MS: z.coerce.number().int().min(1000).max(30_000).default(8000),
  MOCK_XAI: z
    .string()
    .default("false")
    .transform((value) => value.toLowerCase() === "true"),
  GCS_MEMORY_ENABLED: z
    .string()
    .default("false")
    .transform((value) => value.toLowerCase() === "true"),
  GCS_BUCKET: z.string().optional(),
  GCS_PREFIX: z.string().default("deckforge-x/research"),
  GCS_PROJECT_ID: z.string().optional(),
  GCS_CACHE_TTL_HOURS: z.coerce.number().int().min(1).max(720).default(24),
});

const env = envSchema.parse(process.env);

export const config = {
  apiKey: env.OPENAI_API_KEY,
  model: env.OPENAI_MODEL,
  fastModel: env.OPENAI_FAST_MODEL,
  qualityModel: env.OPENAI_QUALITY_MODEL || env.OPENAI_MODEL,
  criticModel: env.OPENAI_CRITIC_MODEL || env.OPENAI_FAST_MODEL,
  reasoningEffort: env.OPENAI_REASONING_EFFORT,
  openaiMaxOutputTokens: env.OPENAI_MAX_OUTPUT_TOKENS,
  agentMaxTotalTokens: env.AGENT_MAX_TOTAL_TOKENS,
  agentArchitecture: env.AGENT_ARCHITECTURE,
  xaiApiKey: env.XAI_API_KEY,
  grokModel: env.GROK_MODEL,
  grokMaxOutputTokens: env.GROK_MAX_OUTPUT_TOKENS,
  xMaxPosts: env.X_MAX_POSTS,
  xSearchCandidates: env.X_SEARCH_CANDIDATES,
  redditEnabled: env.REDDIT_ENABLED,
  redditUserAgent: env.REDDIT_USER_AGENT,
  redditMaxPosts: env.REDDIT_MAX_POSTS,
  redditSearchCandidates: env.REDDIT_SEARCH_CANDIDATES,
  redditTimeoutMs: env.REDDIT_TIMEOUT_MS,
  port: env.PORT,
  mockOpenAI: env.MOCK_OPENAI || !env.OPENAI_API_KEY,
  mockXai: env.MOCK_XAI || !env.XAI_API_KEY,
  gcsMemoryEnabled: env.GCS_MEMORY_ENABLED && Boolean(env.GCS_BUCKET),
  gcsBucket: env.GCS_BUCKET,
  gcsPrefix: env.GCS_PREFIX.replace(/^\/+|\/+$/g, ""),
  gcsProjectId: env.GCS_PROJECT_ID,
  gcsCacheTtlHours: env.GCS_CACHE_TTL_HOURS,
};

