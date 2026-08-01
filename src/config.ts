import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_MODEL: z.string().default("gpt-5.6-sol"),
  OPENAI_FAST_MODEL: z.string().default("gpt-5.6-luna"),
  OPENAI_CRITIC_MODEL: z.string().optional(),
  OPENAI_CRITICAL_MODEL: z.string().default("gpt-5.6-sol"),
  OPENAI_REASONING_EFFORT: z
    .enum(["none", "low", "medium", "high", "xhigh", "max"])
    .default("low"),
  // Deep effort is reserved for the narrative architect, the one role whose
  // judgment quality gates everything downstream.
  OPENAI_CRITICAL_REASONING_EFFORT: z
    .enum(["none", "low", "medium", "high", "xhigh", "max"])
    .default("high"),
  // Standard effort covers the remaining critical roles (art director, composer,
  // critic): constrained outputs where high reasoning mostly adds latency and
  // eats the role's own output cap.
  OPENAI_STANDARD_REASONING_EFFORT: z
    .enum(["none", "low", "medium", "high", "xhigh", "max"])
    .default("medium"),
  OPENAI_SERVICE_TIER: z.enum(["auto", "default", "flex", "priority"]).default("auto"),
  // Priority costs a per-token premium and needs account eligibility; enable it in
  // .env for latency-sensitive live demos rather than by default.
  OPENAI_CRITICAL_SERVICE_TIER: z.enum(["auto", "default", "flex", "priority"]).default("auto"),
  // GPT-5.6 supports up to 128k output tokens per response. These are ceilings,
  // not reservations: the API bills actual usage. Keep the single-agent fallback
  // generous enough that high reasoning cannot crowd out its structured answer.
  OPENAI_MAX_OUTPUT_TOKENS: z.coerce.number().int().min(1000).max(128_000).default(32_000),
  AGENT_PLANNER_MAX_OUTPUT_TOKENS: z.coerce.number().int().min(1000).max(128_000).default(12_000),
  AGENT_EVIDENCE_MAX_OUTPUT_TOKENS: z.coerce.number().int().min(1000).max(128_000).default(24_000),
  AGENT_NARRATIVE_MAX_OUTPUT_TOKENS: z.coerce.number().int().min(1000).max(128_000).default(32_000),
  AGENT_ART_DIRECTOR_MAX_OUTPUT_TOKENS: z.coerce.number().int().min(1000).max(128_000).default(24_000),
  AGENT_COMPOSER_MAX_OUTPUT_TOKENS: z.coerce.number().int().min(1000).max(128_000).default(32_000),
  AGENT_CRITIC_MAX_OUTPUT_TOKENS: z.coerce.number().int().min(1000).max(128_000).default(20_000),
  AGENT_REPAIR_MAX_OUTPUT_TOKENS: z.coerce.number().int().min(1000).max(128_000).default(32_000),
  // GPT-only run budget. The six-role default ceilings total 144k; 500k leaves
  // room for inputs, reasoning, a schema retry, and the repair/recheck path.
  // Grok retrieval usage is observed separately and never draws from this budget.
  AGENT_MAX_TOTAL_TOKENS: z.coerce.number().int().min(5000).max(2_000_000).default(500_000),
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
  YOUTUBE_ENABLED: z.string().default("true").transform((value) => value.toLowerCase() === "true"),
  YOUTUBE_API_KEY: z.string().optional(),
  YOUTUBE_MAX_POSTS: z.coerce.number().int().min(2).max(8).default(6),
  YOUTUBE_VIDEO_CANDIDATES: z.coerce.number().int().min(1).max(5).default(3),
  YOUTUBE_COMMENTS_PER_VIDEO: z.coerce.number().int().min(5).max(100).default(20),
  YOUTUBE_DAILY_CALL_BUDGET: z.coerce.number().int().min(10).max(10_000).default(100),
  YOUTUBE_QUOTA_STOP_RATIO: z.coerce.number().min(0.5).max(0.95).default(0.8),
  YOUTUBE_TIMEOUT_MS: z.coerce.number().int().min(1000).max(30_000).default(8000),
  HACKER_NEWS_ENABLED: z.string().default("true").transform((value) => value.toLowerCase() === "true"),
  HACKER_NEWS_MAX_POSTS: z.coerce.number().int().min(2).max(8).default(4),
  HACKER_NEWS_SEARCH_CANDIDATES: z.coerce.number().int().min(4).max(30).default(12),
  HACKER_NEWS_TIMEOUT_MS: z.coerce.number().int().min(1000).max(30_000).default(8000),
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
  IMAGE_SEARCH_ENABLED: z.string().default("true").transform((value) => value.toLowerCase() === "true"),
  PEXELS_ENABLED: z.string().default("true").transform((value) => value.toLowerCase() === "true"),
  PEXELS_API_KEY: z.string().optional(),
  PEXELS_DAILY_CALL_BUDGET: z.coerce.number().int().min(1).max(10_000).default(100),
  UNSPLASH_ENABLED: z.string().default("true").transform((value) => value.toLowerCase() === "true"),
  UNSPLASH_ACCESS_KEY: z.string().optional(),
  UNSPLASH_DAILY_CALL_BUDGET: z.coerce.number().int().min(1).max(10_000).default(40),
  OFFICIAL_IMAGES_ENABLED: z.string().default("false").transform((value) => value.toLowerCase() === "true"),
  OFFICIAL_IMAGE_ALLOWED_HOSTS: z.string().default(""),
  USER_UPLOADS_ENABLED: z.string().default("true").transform((value) => value.toLowerCase() === "true"),
  DRIBBBLE_REFERENCES_ENABLED: z.string().default("true").transform((value) => value.toLowerCase() === "true"),
  // Image counts must never be the reason a design falls flat: the ceilings cover
  // an image on every slide of a five-slide deck with headroom, and only API
  // quota ledgers (daily budgets, 80% stop) remain as the cost guard.
  IMAGE_CANDIDATES_PER_SLIDE: z.coerce.number().int().min(1).max(6).default(3),
  IMAGE_MAX_PER_DECK: z.coerce.number().int().min(0).max(12).default(8),
  IMAGE_MAX_SEARCH_CALLS_PER_DECK: z.coerce.number().int().min(1).max(24).default(12),
  IMAGE_QUOTA_STOP_RATIO: z.coerce.number().min(0.5).max(0.95).default(0.8),
  IMAGE_MAX_DOWNLOAD_BYTES: z.coerce.number().int().min(100_000).max(25_000_000).default(10_000_000),
  IMAGE_DOWNLOAD_TIMEOUT_MS: z.coerce.number().int().min(1000).max(60_000).default(10_000),
});

const env = envSchema.parse(process.env);

export const config = {
  apiKey: env.OPENAI_API_KEY,
  model: env.OPENAI_MODEL,
  fastModel: env.OPENAI_FAST_MODEL,
  // The independent critic can run on a different model family so it does not share
  // the composer's blind spots; it falls back to the critical tier when unset.
  criticModel: env.OPENAI_CRITIC_MODEL || env.OPENAI_CRITICAL_MODEL,
  criticalModel: env.OPENAI_CRITICAL_MODEL,
  reasoningEffort: env.OPENAI_REASONING_EFFORT,
  criticalReasoningEffort: env.OPENAI_CRITICAL_REASONING_EFFORT,
  standardReasoningEffort: env.OPENAI_STANDARD_REASONING_EFFORT,
  serviceTier: env.OPENAI_SERVICE_TIER,
  criticalServiceTier: env.OPENAI_CRITICAL_SERVICE_TIER,
  openaiMaxOutputTokens: env.OPENAI_MAX_OUTPUT_TOKENS,
  teamRoleTokenLimits: {
    planner: env.AGENT_PLANNER_MAX_OUTPUT_TOKENS,
    evidence: env.AGENT_EVIDENCE_MAX_OUTPUT_TOKENS,
    narrative: env.AGENT_NARRATIVE_MAX_OUTPUT_TOKENS,
    artDirector: env.AGENT_ART_DIRECTOR_MAX_OUTPUT_TOKENS,
    composer: env.AGENT_COMPOSER_MAX_OUTPUT_TOKENS,
    critic: env.AGENT_CRITIC_MAX_OUTPUT_TOKENS,
    repair: env.AGENT_REPAIR_MAX_OUTPUT_TOKENS,
  },
  agentMaxTotalTokens: env.AGENT_MAX_TOTAL_TOKENS,
  agentArchitecture: env.AGENT_ARCHITECTURE,
  xaiApiKey: env.XAI_API_KEY,
  grokModel: env.GROK_MODEL,
  grokMaxOutputTokens: env.GROK_MAX_OUTPUT_TOKENS,
  xMaxPosts: env.X_MAX_POSTS,
  xSearchCandidates: env.X_SEARCH_CANDIDATES,
  youtubeEnabled: env.YOUTUBE_ENABLED && Boolean(env.YOUTUBE_API_KEY),
  youtubeApiKey: env.YOUTUBE_API_KEY,
  youtubeMaxPosts: env.YOUTUBE_MAX_POSTS,
  youtubeVideoCandidates: env.YOUTUBE_VIDEO_CANDIDATES,
  youtubeCommentsPerVideo: env.YOUTUBE_COMMENTS_PER_VIDEO,
  youtubeDailyCallBudget: env.YOUTUBE_DAILY_CALL_BUDGET,
  youtubeQuotaStopRatio: env.YOUTUBE_QUOTA_STOP_RATIO,
  youtubeTimeoutMs: env.YOUTUBE_TIMEOUT_MS,
  hackerNewsEnabled: env.HACKER_NEWS_ENABLED,
  hackerNewsMaxPosts: env.HACKER_NEWS_MAX_POSTS,
  hackerNewsSearchCandidates: env.HACKER_NEWS_SEARCH_CANDIDATES,
  hackerNewsTimeoutMs: env.HACKER_NEWS_TIMEOUT_MS,
  port: env.PORT,
  mockOpenAI: env.MOCK_OPENAI || !env.OPENAI_API_KEY,
  mockXai: env.MOCK_XAI || !env.XAI_API_KEY,
  gcsMemoryEnabled: env.GCS_MEMORY_ENABLED && Boolean(env.GCS_BUCKET),
  gcsBucket: env.GCS_BUCKET,
  gcsPrefix: env.GCS_PREFIX.replace(/^\/+|\/+$/g, ""),
  gcsProjectId: env.GCS_PROJECT_ID,
  gcsCacheTtlHours: env.GCS_CACHE_TTL_HOURS,
  imageSearchEnabled: env.IMAGE_SEARCH_ENABLED,
  pexelsEnabled: env.IMAGE_SEARCH_ENABLED && env.PEXELS_ENABLED && Boolean(env.PEXELS_API_KEY),
  pexelsApiKey: env.PEXELS_API_KEY,
  pexelsDailyCallBudget: env.PEXELS_DAILY_CALL_BUDGET,
  unsplashEnabled: env.IMAGE_SEARCH_ENABLED && env.UNSPLASH_ENABLED && Boolean(env.UNSPLASH_ACCESS_KEY),
  unsplashAccessKey: env.UNSPLASH_ACCESS_KEY,
  unsplashDailyCallBudget: env.UNSPLASH_DAILY_CALL_BUDGET,
  officialImageAllowedHosts: env.OFFICIAL_IMAGE_ALLOWED_HOSTS
    .split(",")
    .map((host) => host.trim().toLocaleLowerCase())
    .filter(Boolean),
  officialImagesEnabled: env.OFFICIAL_IMAGES_ENABLED && env.OFFICIAL_IMAGE_ALLOWED_HOSTS.trim().length > 0,
  userUploadsEnabled: env.USER_UPLOADS_ENABLED,
  dribbbleReferencesEnabled: env.DRIBBBLE_REFERENCES_ENABLED,
  imageCandidatesPerSlide: env.IMAGE_CANDIDATES_PER_SLIDE,
  imageMaxPerDeck: env.IMAGE_MAX_PER_DECK,
  imageMaxSearchCallsPerDeck: env.IMAGE_MAX_SEARCH_CALLS_PER_DECK,
  imageQuotaStopRatio: env.IMAGE_QUOTA_STOP_RATIO,
  imageMaxDownloadBytes: env.IMAGE_MAX_DOWNLOAD_BYTES,
  imageDownloadTimeoutMs: env.IMAGE_DOWNLOAD_TIMEOUT_MS,
};
