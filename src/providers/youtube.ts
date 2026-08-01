import { config } from "../config.js";
import { traceEvents } from "../events/event-bus.js";
import { loadYouTubeResearchMemory, saveYouTubeResearchMemory } from "../memory/gcs-research.js";
import { complaintSignalScore, isQueryRelevant } from "../research/community-signal.js";
import { regionCodeForCountry, type ResearchMarket } from "../research/markets.js";
import { communityPostSchema, type CommunityPost } from "../team/contracts.js";
import { youtubeQuotaLedger } from "./youtube-quota.js";

export interface YouTubeSearchInput {
  lane: "topic" | "design_critique";
  query: string;
  // Stable brief-derived cache key; the research memory prefers it over the query.
  cacheSeed?: string;
  markets: ResearchMarket[];
  maxPosts?: number;
  fromDate: string | null;
  toDate: string | null;
}

export interface YouTubeResearchResult {
  type: "youtube_search_result";
  lane: YouTubeSearchInput["lane"];
  posts: CommunityPost[];
  videosExamined: number;
  calls: number;
  cache: "disabled" | "hit" | "miss";
  warning: string | null;
}

interface YouTubeVideoCandidate {
  id: string;
  title: string;
  channelTitle: string;
  publishedAt: string | null;
  discoveryMarket: string;
  regionCode: string | null;
}

interface YouTubeApiResult {
  ok: boolean;
  status: number;
  data: unknown;
  reason: string | null;
  message: string | null;
}

function detectLanguage(value: string): string {
  if (/[가-힣]/u.test(value)) return "ko";
  if (/[ぁ-んァ-ン]/u.test(value)) return "ja";
  if (/[一-鿿]/u.test(value)) return "zh";
  return "en";
}

function decodeHtml(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&#x27;|&apos;/gi, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function errorDetails(value: unknown): { reason: string | null; message: string | null } {
  if (!value || typeof value !== "object") return { reason: null, message: null };
  const error = (value as { error?: unknown }).error;
  if (!error || typeof error !== "object") return { reason: null, message: null };
  const record = error as { message?: unknown; errors?: unknown[]; status?: unknown };
  const first = Array.isArray(record.errors) && record.errors[0] && typeof record.errors[0] === "object"
    ? record.errors[0] as { reason?: unknown }
    : null;
  return {
    reason: typeof first?.reason === "string" ? first.reason : typeof record.status === "string" ? record.status : null,
    message: typeof record.message === "string" ? record.message.slice(0, 300) : null,
  };
}

async function youtubeGet(resource: "search" | "commentThreads", params: URLSearchParams): Promise<YouTubeApiResult> {
  const decision = youtubeQuotaLedger.canCall(config.youtubeDailyCallBudget, config.youtubeQuotaStopRatio);
  if (!decision.allowed) {
    return { ok: false, status: 0, data: null, reason: decision.reason, message: `YouTube call blocked: ${decision.reason}.` };
  }
  youtubeQuotaLedger.recordAttempt();
  params.set("key", config.youtubeApiKey || "");
  try {
    const response = await fetch(`https://www.googleapis.com/youtube/v3/${resource}?${params}`, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(config.youtubeTimeoutMs),
    });
    const data = await response.json().catch(() => null);
    const details = errorDetails(data);
    youtubeQuotaLedger.recordResponse(response.status, details.reason, response.headers);
    return { ok: response.ok, status: response.status, data, ...details };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown YouTube request failure";
    return { ok: false, status: 0, data: null, reason: "network_error", message };
  }
}

export function parseYouTubeVideos(
  payload: unknown,
  limit: number,
  discoveryMarket = "",
  requestedRegionCode: string | null = null,
): YouTubeVideoCandidate[] {
  const items = payload && typeof payload === "object" ? (payload as { items?: unknown[] }).items : null;
  const responseRegionCode = payload && typeof payload === "object" && typeof (payload as { regionCode?: unknown }).regionCode === "string"
    ? (payload as { regionCode: string }).regionCode
    : requestedRegionCode;
  if (!Array.isArray(items)) return [];
  return items.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const record = item as { id?: { videoId?: unknown }; snippet?: Record<string, unknown> };
    const id = typeof record.id?.videoId === "string" ? record.id.videoId : "";
    if (!id) return [];
    const snippet = record.snippet ?? {};
    const publishedAt = typeof snippet.publishedAt === "string" && !Number.isNaN(Date.parse(snippet.publishedAt))
      ? new Date(snippet.publishedAt).toISOString()
      : null;
    return [{
      id,
      title: decodeHtml(typeof snippet.title === "string" ? snippet.title : "YouTube video").slice(0, 180),
      channelTitle: decodeHtml(typeof snippet.channelTitle === "string" ? snippet.channelTitle : "YouTube").slice(0, 80),
      publishedAt,
      discoveryMarket,
      regionCode: responseRegionCode,
    }];
  }).slice(0, limit);
}

export function parseYouTubeComments(
  payload: unknown,
  input: Pick<YouTubeSearchInput, "lane" | "fromDate" | "toDate">,
  video: YouTubeVideoCandidate,
): CommunityPost[] {
  const items = payload && typeof payload === "object" ? (payload as { items?: unknown[] }).items : null;
  if (!Array.isArray(items)) return [];
  return items.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const thread = item as { snippet?: { topLevelComment?: { id?: unknown; snippet?: Record<string, unknown> }; totalReplyCount?: unknown } };
    const comment = thread.snippet?.topLevelComment;
    const commentId = typeof comment?.id === "string" ? comment.id : "";
    const snippet = comment?.snippet ?? {};
    const text = typeof snippet.textOriginal === "string"
      ? snippet.textOriginal
      : typeof snippet.textDisplay === "string" ? snippet.textDisplay : "";
    if (!commentId || text.trim().length < 3) return [];
    const postedAt = typeof snippet.publishedAt === "string" && !Number.isNaN(Date.parse(snippet.publishedAt))
      ? new Date(snippet.publishedAt).toISOString()
      : null;
    if (input.fromDate && (!postedAt || Date.parse(postedAt) < Date.parse(`${input.fromDate}T00:00:00Z`))) return [];
    if (input.toDate && (!postedAt || Date.parse(postedAt) >= Date.parse(nextDay(input.toDate)))) return [];
    const parsed = communityPostSchema.safeParse({
      lane: input.lane,
      platform: "youtube",
      url: `https://www.youtube.com/watch?v=${encodeURIComponent(video.id)}&lc=${encodeURIComponent(commentId)}`,
      title: video.title,
      author: typeof snippet.authorDisplayName === "string" ? snippet.authorDisplayName.slice(0, 80) : "YouTube user",
      community: `YouTube · ${video.channelTitle}`.slice(0, 80),
      excerpt: text.replace(/\s+/g, " ").trim().slice(0, 280),
      // A video's region or language does not establish a comment author's country.
      country: "",
      ...(video.discoveryMarket ? { discoveryMarket: video.discoveryMarket } : {}),
      language: detectLanguage(text),
      postedAt,
      engagement: {
        likes: typeof snippet.likeCount === "number" ? snippet.likeCount : null,
        reposts: null,
        score: null,
        comments: typeof thread.snippet?.totalReplyCount === "number" ? thread.snippet.totalReplyCount : null,
      },
    });
    return parsed.success ? [parsed.data] : [];
  });
}

function videoId(post: CommunityPost): string {
  try {
    return new URL(post.url).searchParams.get("v") || post.url;
  } catch {
    return post.url;
  }
}

export function rankYouTubeComments(posts: CommunityPost[], limit: number, now = Date.now()): CommunityPost[] {
  const score = (post: CommunityPost): number => {
    const signal = complaintSignalScore(post.excerpt);
    const popularity = Math.min(1, Math.log1p((post.engagement.likes ?? 0) + (post.engagement.comments ?? 0) * 2) / Math.log1p(10_000));
    const ageDays = post.postedAt ? Math.max(0, (now - Date.parse(post.postedAt)) / 86_400_000) : 365;
    const recency = ageDays <= 30 ? 1 : ageDays <= 90 ? 0.7 : ageDays <= 365 ? 0.35 : 0;
    return signal * 0.5 + popularity * 0.3 + recency * 0.2;
  };
  // Both lanes collect complaints and criticism; a pure-praise comment can never
  // be that evidence no matter how many likes it has.
  const ranked = posts
    .filter((post) => complaintSignalScore(post.excerpt) > 0)
    .map((post, index) => ({ post, index }))
    .sort((left, right) => score(right.post) - score(left.post) || left.index - right.index)
    .map(({ post }) => post);
  const selected: CommunityPost[] = [];
  const usedVideos = new Set<string>();
  for (const post of ranked) {
    const id = videoId(post);
    if (usedVideos.has(id)) continue;
    usedVideos.add(id);
    selected.push(post);
    if (selected.length >= limit) return selected;
  }
  for (const post of ranked) {
    if (selected.includes(post)) continue;
    selected.push(post);
    if (selected.length >= limit) break;
  }
  return selected;
}

function nextDay(date: string): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + 86_400_000).toISOString();
}

function warningText(result: YouTubeApiResult, operation: string): string {
  const detail = [result.reason, result.message].filter(Boolean).join(": ");
  return `YouTube ${operation} returned ${result.status || "no response"}${detail ? ` (${detail})` : ""}.`;
}

export async function researchYouTube(
  input: YouTubeSearchInput,
  runId: string,
): Promise<YouTubeResearchResult> {
  traceEvents.emit(runId, "tool_call", { type: "youtube_search", input });
  if (!config.youtubeEnabled) {
    const disabled: YouTubeResearchResult = {
      type: "youtube_search_result",
      lane: input.lane,
      posts: [],
      videosExamined: 0,
      calls: 0,
      cache: "disabled",
      warning: "YouTube research is disabled or YOUTUBE_API_KEY is missing.",
    };
    traceEvents.emit(runId, "tool_result", disabled);
    return disabled;
  }

  const maxPosts = Math.min(config.youtubeMaxPosts, input.maxPosts ?? config.youtubeMaxPosts);
  const relevanceLanguage = input.markets.map((market) => market.searchLanguage).join(",") || "en";
  const memoryInput = {
    lane: input.lane,
    query: input.query,
    cacheSeed: input.cacheSeed ?? null,
    markets: input.markets,
    maxPosts,
    fromDate: input.fromDate,
    toDate: input.toDate,
    videoCandidates: config.youtubeVideoCandidates,
    commentsPerVideo: config.youtubeCommentsPerVideo,
    relevanceLanguage,
  };
  const cached = await loadYouTubeResearchMemory(memoryInput);
  if (cached.record) {
    const hit: YouTubeResearchResult = {
      type: "youtube_search_result",
      lane: input.lane,
      posts: cached.record.posts,
      videosExamined: cached.record.videosExamined,
      calls: 0,
      cache: "hit",
      warning: cached.warning,
    };
    traceEvents.emit(runId, "tool_result", hit);
    return hit;
  }

  const beforeCalls = youtubeQuotaLedger.snapshot().callsToday;
  const warnings: string[] = [];
  const videos: YouTubeVideoCandidate[] = [];
  const markets = input.markets.length > 0 ? input.markets : [{ country: "", searchLanguage: "en" }];
  const marketCount = Math.min(markets.length, config.youtubeVideoCandidates);
  let remainingVideos = config.youtubeVideoCandidates;
  for (let index = 0; index < marketCount; index += 1) {
    const market = markets[index]!;
    const marketsLeft = marketCount - index;
    const allocation = Math.ceil(remainingVideos / marketsLeft);
    remainingVideos -= allocation;
    const requestedRegionCode = regionCodeForCountry(market.country);
    if (market.country && !requestedRegionCode) {
      warnings.push(`YouTube region code is unavailable for ${market.country}; that market was searched by language only.`);
    }
    const searchParams = new URLSearchParams({
      part: "snippet",
      type: "video",
      q: input.query,
      maxResults: String(allocation),
      order: "relevance",
      relevanceLanguage: market.searchLanguage || "en",
      safeSearch: "strict",
    });
    if (requestedRegionCode) searchParams.set("regionCode", requestedRegionCode);
    if (input.fromDate) searchParams.set("publishedAfter", `${input.fromDate}T00:00:00Z`);
    if (input.toDate) searchParams.set("publishedBefore", nextDay(input.toDate));
    const search = await youtubeGet("search", searchParams);
    if (!search.ok) {
      warnings.push(warningText(search, `video search for ${market.country || market.searchLanguage}`));
      if ((search.reason || "").includes("no_retry") || search.reason === "local_daily_80_percent_stop") break;
      continue;
    }
    const discovered = parseYouTubeVideos(
      search.data,
      allocation,
      requestedRegionCode ? market.country : "",
      requestedRegionCode,
    );
    for (const video of discovered) {
      // A video whose title shares nothing with the query drags its whole comment
      // thread off-topic; comments inherit relevance from the video.
      if (!isQueryRelevant(video.title, input.query, 1)) continue;
      if (!videos.some((existing) => existing.id === video.id)) videos.push(video);
    }
  }

  const candidates: CommunityPost[] = [];
  for (const video of videos) {
    const params = new URLSearchParams({
      part: "snippet",
      videoId: video.id,
      maxResults: String(config.youtubeCommentsPerVideo),
      order: "relevance",
      textFormat: "plainText",
    });
    const comments = await youtubeGet("commentThreads", params);
    if (!comments.ok) {
      warnings.push(warningText(comments, `comments for video ${video.id}`));
      if (["quotaExceeded", "dailyLimitExceeded", "local_daily_80_percent_stop", "http_429_no_retry"].includes(comments.reason || "")) break;
      continue;
    }
    candidates.push(...parseYouTubeComments(comments.data, input, video));
  }

  const posts = rankYouTubeComments(candidates, maxPosts);
  const saveWarning = await saveYouTubeResearchMemory(memoryInput, { posts, videosExamined: videos.length });
  if (posts.length === 0) warnings.push("YouTube search returned no usable public comments.");
  if (cached.warning) warnings.push(cached.warning);
  if (saveWarning) warnings.push(saveWarning);
  const result: YouTubeResearchResult = {
    type: "youtube_search_result",
    lane: input.lane,
    posts,
    videosExamined: videos.length,
    calls: youtubeQuotaLedger.snapshot().callsToday - beforeCalls,
    cache: config.gcsMemoryEnabled ? "miss" : "disabled",
    warning: warnings.join(" ") || null,
  };
  traceEvents.emit(runId, "tool_result", result);
  return result;
}
