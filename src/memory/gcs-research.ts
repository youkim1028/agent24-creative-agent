import { createHash } from "node:crypto";
import { Storage } from "@google-cloud/storage";
import { z } from "zod";
import { config } from "../config.js";
import { citationSchema } from "../deck/schema.js";
import type { ResearchMarket } from "../research/markets.js";
import { communityPostSchema } from "../team/contracts.js";

export type ResearchLane = "topic" | "design_critique";
export type ResearchPlatform = "x" | "youtube" | "hacker_news";

const marketSchema = z.object({ country: z.string(), searchLanguage: z.string() });
const baseRecordSchema = z.object({
  version: z.literal(5),
  platform: z.enum(["x", "youtube", "hacker_news"]),
  lane: z.enum(["topic", "design_critique"]),
  collectedAt: z.string().datetime(),
  expiresAt: z.string().datetime(),
  markets: z.array(marketSchema).max(3),
  sourceCount: z.number().int().nonnegative(),
});

const xRecordSchema = baseRecordSchema.extend({
  platform: z.literal("x"),
  extract: z.string().max(6000),
  citations: z.array(citationSchema).max(8),
}).refine((record) => record.sourceCount === record.citations.length, {
  message: "sourceCount must match citations length",
});

const youtubeRecordSchema = baseRecordSchema.extend({
  platform: z.literal("youtube"),
  posts: z.array(communityPostSchema).max(8),
  videosExamined: z.number().int().nonnegative().max(10),
}).refine((record) => record.sourceCount === record.posts.length, {
  message: "sourceCount must match posts length",
});

const hackerNewsRecordSchema = baseRecordSchema.extend({
  platform: z.literal("hacker_news"),
  posts: z.array(communityPostSchema).max(8),
}).refine((record) => record.sourceCount === record.posts.length, {
  message: "sourceCount must match posts length",
});

export type ResearchMemoryRecord = z.infer<typeof xRecordSchema>;
export type YouTubeResearchMemoryRecord = z.infer<typeof youtubeRecordSchema>;
export type HackerNewsResearchMemoryRecord = z.infer<typeof hackerNewsRecordSchema>;

interface SharedMemoryIdentity {
  lane: ResearchLane;
  query: string;
  // Stable run-request seed (brief + additional context). The cache key prefers
  // this over the LLM-generated query: planner wording shifts on every run, and
  // keying on it made repeat runs near-guaranteed cache misses.
  cacheSeed?: string | null;
  markets: ResearchMarket[];
  maxPosts: number;
  fromDate: string | null;
  toDate: string | null;
}

export interface ResearchMemoryIdentity extends SharedMemoryIdentity {
  allowedHandles: string[];
}

export interface YouTubeResearchMemoryIdentity extends SharedMemoryIdentity {
  videoCandidates: number;
  commentsPerVideo: number;
  relevanceLanguage: string;
}

export interface HackerNewsResearchMemoryIdentity extends SharedMemoryIdentity {
  searchCandidates: number;
}

type MemoryIdentity = ResearchMemoryIdentity | YouTubeResearchMemoryIdentity | HackerNewsResearchMemoryIdentity;

function normalizedIdentity(platform: ResearchPlatform, input: MemoryIdentity): object {
  const markets = input.markets
    .map((market) => ({ country: market.country.trim().toLowerCase(), searchLanguage: market.searchLanguage.trim().toLowerCase() }))
    .sort((left, right) => `${left.country}\u0000${left.searchLanguage}`.localeCompare(`${right.country}\u0000${right.searchLanguage}`, "en"));
  const normalizedList = (values: string[], stripPrefix: RegExp): string[] => [
    ...new Set(values.map((value) => value.trim().toLowerCase().replace(stripPrefix, "")).filter(Boolean)),
  ].sort();
  const keySource = input.cacheSeed?.trim() ? input.cacheSeed : input.query;
  return {
    version: 5,
    platform,
    lane: input.lane,
    query: keySource.trim().toLowerCase().replace(/\s+/g, " "),
    markets,
    maxPosts: input.maxPosts,
    fromDate: input.fromDate,
    toDate: input.toDate,
    ...(platform === "x"
      ? { allowedHandles: normalizedList((input as ResearchMemoryIdentity).allowedHandles, /^@/) }
      : platform === "youtube" ? {
          videoCandidates: (input as YouTubeResearchMemoryIdentity).videoCandidates,
          commentsPerVideo: (input as YouTubeResearchMemoryIdentity).commentsPerVideo,
          relevanceLanguage: (input as YouTubeResearchMemoryIdentity).relevanceLanguage.trim().toLowerCase(),
        } : { searchCandidates: (input as HackerNewsResearchMemoryIdentity).searchCandidates }),
  };
}

export function researchMemoryObjectName(
  platform: ResearchPlatform,
  input: MemoryIdentity,
): string {
  const hash = createHash("sha256").update(JSON.stringify(normalizedIdentity(platform, input))).digest("hex");
  return `${config.gcsPrefix}/v5/${platform}/${input.lane}/${hash}.json`;
}

function storageClient(): Storage {
  return new Storage(config.gcsProjectId ? { projectId: config.gcsProjectId } : undefined);
}

async function loadRecord<T>(
  platform: ResearchPlatform,
  input: MemoryIdentity,
  schema: z.ZodType<T>,
): Promise<{ record: T | null; warning: string | null }> {
  if (!config.gcsMemoryEnabled || !config.gcsBucket) return { record: null, warning: null };
  try {
    const [bytes] = await storageClient().bucket(config.gcsBucket).file(researchMemoryObjectName(platform, input)).download();
    const record = schema.parse(JSON.parse(bytes.toString("utf8")));
    const expiresAt = (record as { expiresAt: string }).expiresAt;
    if (Date.parse(expiresAt) <= Date.now()) return { record: null, warning: null };
    return { record, warning: null };
  } catch (error) {
    const code = typeof error === "object" && error && "code" in error ? String((error as { code: unknown }).code) : "";
    if (code === "404") return { record: null, warning: null };
    const message = error instanceof Error ? error.message : "Unknown GCS read failure";
    return { record: null, warning: `GCS ${platform}/${input.lane} cache read skipped: ${message}` };
  }
}

async function saveRecord(
  platform: ResearchPlatform,
  input: MemoryIdentity,
  record: ResearchMemoryRecord | YouTubeResearchMemoryRecord | HackerNewsResearchMemoryRecord,
): Promise<string | null> {
  if (!config.gcsMemoryEnabled || !config.gcsBucket) return null;
  try {
    await storageClient().bucket(config.gcsBucket).file(researchMemoryObjectName(platform, input)).save(JSON.stringify(record), {
      resumable: false,
      contentType: "application/json",
      metadata: { cacheControl: "private, no-store" },
    });
    return null;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown GCS write failure";
    return `GCS ${platform}/${input.lane} cache write skipped: ${message}`;
  }
}

function recordTimes(): { collectedAt: string; expiresAt: string } {
  const collectedAt = new Date();
  return {
    collectedAt: collectedAt.toISOString(),
    expiresAt: new Date(collectedAt.getTime() + config.gcsCacheTtlHours * 60 * 60 * 1000).toISOString(),
  };
}

export async function loadResearchMemory(
  input: ResearchMemoryIdentity,
): Promise<{ record: ResearchMemoryRecord | null; warning: string | null }> {
  return loadRecord("x", input, xRecordSchema);
}

export async function saveResearchMemory(
  input: ResearchMemoryIdentity,
  value: Pick<ResearchMemoryRecord, "extract" | "citations">,
): Promise<string | null> {
  const citations = value.citations.slice(0, input.maxPosts).flatMap((citation) => {
    const parsed = citationSchema.safeParse(citation);
    return parsed.success ? [parsed.data] : [];
  });
  return saveRecord("x", input, {
    version: 5,
    platform: "x",
    lane: input.lane,
    ...recordTimes(),
    markets: input.markets,
    sourceCount: citations.length,
    extract: value.extract.slice(0, 6000),
    citations,
  });
}

export async function loadYouTubeResearchMemory(
  input: YouTubeResearchMemoryIdentity,
): Promise<{ record: YouTubeResearchMemoryRecord | null; warning: string | null }> {
  return loadRecord("youtube", input, youtubeRecordSchema);
}

export async function saveYouTubeResearchMemory(
  input: YouTubeResearchMemoryIdentity,
  value: Pick<YouTubeResearchMemoryRecord, "posts" | "videosExamined">,
): Promise<string | null> {
  const bounded = value.posts.slice(0, input.maxPosts);
  return saveRecord("youtube", input, {
    version: 5,
    platform: "youtube",
    lane: input.lane,
    ...recordTimes(),
    markets: input.markets,
    sourceCount: bounded.length,
    posts: bounded,
    videosExamined: value.videosExamined,
  });
}

export async function loadHackerNewsResearchMemory(
  input: HackerNewsResearchMemoryIdentity,
): Promise<{ record: HackerNewsResearchMemoryRecord | null; warning: string | null }> {
  return loadRecord("hacker_news", input, hackerNewsRecordSchema);
}

export async function saveHackerNewsResearchMemory(
  input: HackerNewsResearchMemoryIdentity,
  posts: HackerNewsResearchMemoryRecord["posts"],
): Promise<string | null> {
  const bounded = posts.slice(0, input.maxPosts);
  return saveRecord("hacker_news", input, {
    version: 5,
    platform: "hacker_news",
    lane: input.lane,
    ...recordTimes(),
    markets: input.markets,
    sourceCount: bounded.length,
    posts: bounded,
  });
}
