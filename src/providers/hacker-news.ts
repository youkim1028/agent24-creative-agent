import { config } from "../config.js";
import { traceEvents } from "../events/event-bus.js";
import { loadHackerNewsResearchMemory, saveHackerNewsResearchMemory } from "../memory/gcs-research.js";
import { complaintSignalScore, isQueryRelevant } from "../research/community-signal.js";
import type { ResearchMarket } from "../research/markets.js";
import { communityPostSchema, type CommunityPost } from "../team/contracts.js";

export interface HackerNewsSearchInput {
  lane: "topic" | "design_critique";
  query: string;
  // Stable brief-derived cache key; the research memory prefers it over the query.
  cacheSeed?: string;
  markets: ResearchMarket[];
  maxPosts?: number;
  fromDate: string | null;
  toDate: string | null;
}

export interface HackerNewsResearchResult {
  type: "hacker_news_search_result";
  lane: HackerNewsSearchInput["lane"];
  posts: CommunityPost[];
  candidatesExamined: number;
  calls: number;
  cache: "disabled" | "hit" | "miss";
  warning: string | null;
}

function decodeHtml(value: string): string {
  return value
    .replace(/<[^>]*>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&#x27;|&apos;/gi, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#x2F;/gi, "/")
    .replace(/\s+/g, " ")
    .trim();
}

function detectLanguage(value: string): string {
  if (/[가-힣]/u.test(value)) return "ko";
  if (/[ぁ-んァ-ン]/u.test(value)) return "ja";
  if (/[一-鿿]/u.test(value)) return "zh";
  return "en";
}

function epochStart(date: string): number {
  return Math.floor(Date.parse(`${date}T00:00:00Z`) / 1000);
}

function epochAfter(date: string): number {
  return Math.floor((Date.parse(`${date}T00:00:00Z`) + 86_400_000) / 1000);
}

export function parseHackerNewsSearch(
  payload: unknown,
  input: HackerNewsSearchInput,
  limit: number,
): CommunityPost[] {
  const hits = payload && typeof payload === "object" ? (payload as { hits?: unknown[] }).hits : null;
  if (!Array.isArray(hits)) return [];
  return hits.flatMap((hit) => {
    if (!hit || typeof hit !== "object") return [];
    const record = hit as Record<string, unknown>;
    const objectId = typeof record.objectID === "string" ? record.objectID : "";
    if (!/^\d+$/.test(objectId)) return [];
    const postedAt = typeof record.created_at === "string" && !Number.isNaN(Date.parse(record.created_at))
      ? new Date(record.created_at).toISOString()
      : null;
    if (input.fromDate && (!postedAt || Date.parse(postedAt) < Date.parse(`${input.fromDate}T00:00:00Z`))) return [];
    if (input.toDate && (!postedAt || Date.parse(postedAt) >= Date.parse(`${input.toDate}T00:00:00Z`) + 86_400_000)) return [];
    const title = decodeHtml(
      typeof record.title === "string" ? record.title
        : typeof record.story_title === "string" ? record.story_title
          : "Hacker News discussion",
    ).slice(0, 180);
    const rawText = typeof record.comment_text === "string" ? record.comment_text
      : typeof record.story_text === "string" ? record.story_text
        : title;
    const excerpt = decodeHtml(rawText).slice(0, 280);
    if (excerpt.length < 3) return [];
    const parsed = communityPostSchema.safeParse({
      lane: input.lane,
      platform: "hacker_news",
      url: `https://news.ycombinator.com/item?id=${objectId}`,
      title: title || "Hacker News discussion",
      author: typeof record.author === "string" ? record.author.slice(0, 80) : "HN user",
      community: "Hacker News",
      excerpt,
      country: "",
      language: detectLanguage(excerpt),
      postedAt,
      engagement: {
        likes: null,
        reposts: null,
        score: typeof record.points === "number" && record.points >= 0 ? record.points : null,
        comments: typeof record.num_comments === "number" && record.num_comments >= 0 ? record.num_comments : null,
      },
    });
    return parsed.success ? [parsed.data] : [];
  }).slice(0, limit);
}

export function rankHackerNewsPosts(posts: CommunityPost[], limit: number, now = Date.now()): CommunityPost[] {
  const score = (post: CommunityPost): number => {
    const signal = complaintSignalScore(`${post.title} ${post.excerpt}`);
    const popularity = Math.min(1, Math.log1p((post.engagement.score ?? 0) + (post.engagement.comments ?? 0) * 2) / Math.log1p(10_000));
    const ageDays = post.postedAt ? Math.max(0, (now - Date.parse(post.postedAt)) / 86_400_000) : 365;
    const recency = ageDays <= 30 ? 1 : ageDays <= 90 ? 0.7 : ageDays <= 365 ? 0.35 : 0;
    return signal * 0.5 + popularity * 0.3 + recency * 0.2;
  };
  // Both lanes collect complaints and criticism; keyword search also returns
  // popular but praise-only or listicle posts, which are never that evidence.
  return posts
    .filter((post) => complaintSignalScore(`${post.title} ${post.excerpt}`) > 0)
    .map((post, index) => ({ post, index }))
    .sort((left, right) => score(right.post) - score(left.post) || left.index - right.index)
    .slice(0, limit)
    .map(({ post }) => post);
}

export async function researchHackerNews(
  input: HackerNewsSearchInput,
  runId: string,
): Promise<HackerNewsResearchResult> {
  traceEvents.emit(runId, "tool_call", { type: "hacker_news_search", input });
  if (!config.hackerNewsEnabled) {
    const disabled: HackerNewsResearchResult = {
      type: "hacker_news_search_result", lane: input.lane, posts: [], candidatesExamined: 0,
      calls: 0, cache: "disabled", warning: "Hacker News research is disabled.",
    };
    traceEvents.emit(runId, "tool_result", disabled);
    return disabled;
  }

  const maxPosts = Math.min(config.hackerNewsMaxPosts, input.maxPosts ?? config.hackerNewsMaxPosts);
  const memoryInput = {
    lane: input.lane,
    query: input.query,
    cacheSeed: input.cacheSeed ?? null,
    markets: input.markets,
    maxPosts,
    fromDate: input.fromDate,
    toDate: input.toDate,
    searchCandidates: config.hackerNewsSearchCandidates,
  };
  const cached = await loadHackerNewsResearchMemory(memoryInput);
  if (cached.record) {
    const hit: HackerNewsResearchResult = {
      type: "hacker_news_search_result", lane: input.lane, posts: cached.record.posts,
      candidatesExamined: cached.record.posts.length, calls: 0, cache: "hit", warning: cached.warning,
    };
    traceEvents.emit(runId, "tool_result", hit);
    return hit;
  }

  const numericFilters: string[] = [];
  if (input.fromDate) numericFilters.push(`created_at_i>=${epochStart(input.fromDate)}`);
  if (input.toDate) numericFilters.push(`created_at_i<${epochAfter(input.toDate)}`);
  const params = new URLSearchParams({
    query: input.query,
    tags: "(story,comment)",
    hitsPerPage: String(config.hackerNewsSearchCandidates),
  });
  if (numericFilters.length > 0) params.set("numericFilters", numericFilters.join(","));

  try {
    const response = await fetch(`https://hn.algolia.com/api/v1/search?${params}`, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(config.hackerNewsTimeoutMs),
    });
    if (!response.ok) {
      const result: HackerNewsResearchResult = {
        type: "hacker_news_search_result", lane: input.lane, posts: [], candidatesExamined: 0,
        calls: 1, cache: config.gcsMemoryEnabled ? "miss" : "disabled",
        warning: `Hacker News search returned HTTP ${response.status}; no retry was attempted.`,
      };
      traceEvents.emit(runId, "tool_result", result);
      return result;
    }
    const payload = await response.json();
    const candidates = parseHackerNewsSearch(payload, input, config.hackerNewsSearchCandidates)
      // Algolia matches any token, so demand real topical overlap with the query
      // before a discussion can enter the rubric pipeline.
      .filter((post) => isQueryRelevant(`${post.title} ${post.excerpt}`, input.query, 2));
    const posts = rankHackerNewsPosts(candidates, maxPosts);
    const saveWarning = await saveHackerNewsResearchMemory(memoryInput, posts);
    const warning = [posts.length === 0 ? "Hacker News search returned no usable discussions." : null, cached.warning, saveWarning]
      .filter(Boolean).join(" ") || null;
    const result: HackerNewsResearchResult = {
      type: "hacker_news_search_result", lane: input.lane, posts,
      candidatesExamined: candidates.length, calls: 1,
      cache: config.gcsMemoryEnabled ? "miss" : "disabled", warning,
    };
    traceEvents.emit(runId, "tool_result", result);
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown Hacker News request failure";
    const result: HackerNewsResearchResult = {
      type: "hacker_news_search_result", lane: input.lane, posts: [], candidatesExamined: 0,
      calls: 1, cache: config.gcsMemoryEnabled ? "miss" : "disabled",
      warning: `Hacker News search skipped: ${message}`,
    };
    traceEvents.emit(runId, "tool_result", result);
    return result;
  }
}
