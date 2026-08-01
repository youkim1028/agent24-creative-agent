import { config } from "../config.js";
import type { ResearchMarket } from "../research/markets.js";
import { communityPostSchema, type CommunityPost } from "../team/contracts.js";

export interface RedditSearchInput {
  lane: "topic" | "design_critique";
  query: string;
  markets: ResearchMarket[];
  subredditHints?: string[];
  maxPosts?: number;
}

export function rankRedditPosts(posts: CommunityPost[], limit: number, now = Date.now()): CommunityPost[] {
  const score = (post: CommunityPost): number => {
    const popularity = Math.min(1, Math.log1p((post.engagement.score ?? 0) + (post.engagement.comments ?? 0) * 2) / Math.log1p(10_000));
    const ageDays = post.postedAt ? Math.max(0, (now - Date.parse(post.postedAt)) / 86_400_000) : 365;
    const recency = ageDays <= 30 ? 1 : ageDays <= 90 ? 0.7 : ageDays <= 365 ? 0.35 : 0;
    return popularity * 0.65 + recency * 0.35;
  };
  return posts
    .map((post, index) => ({ post, index }))
    .sort((left, right) => score(right.post) - score(left.post) || left.index - right.index)
    .slice(0, limit)
    .map(({ post }) => post);
}

function detectLanguage(value: string): string {
  if (/[가-힣]/u.test(value)) return "ko";
  if (/[ぁ-んァ-ン]/u.test(value)) return "ja";
  if (/[一-鿿]/u.test(value)) return "zh";
  return "en";
}

function inferCountry(value: string, markets: ResearchMarket[]): string {
  const lower = value.toLocaleLowerCase();
  return markets.find((market) => lower.includes(market.country.toLocaleLowerCase()))?.country ?? "";
}

export function parseRedditSearch(
  payload: unknown,
  input: RedditSearchInput,
  limit: number,
): CommunityPost[] {
  if (!payload || typeof payload !== "object") return [];
  const children = (payload as { data?: { children?: unknown[] } }).data?.children;
  if (!Array.isArray(children)) return [];
  const found: CommunityPost[] = [];
  const seen = new Set<string>();

  for (const child of children) {
    if (!child || typeof child !== "object") continue;
    const data = (child as { data?: Record<string, unknown> }).data;
    if (!data || data.over_18 === true) continue;
    const permalink = typeof data.permalink === "string" ? data.permalink : "";
    if (!permalink) continue;
    const url = new URL(permalink, "https://www.reddit.com").toString();
    if (seen.has(url)) continue;
    seen.add(url);
    const title = typeof data.title === "string" ? data.title.slice(0, 180) : "";
    const selftext = typeof data.selftext === "string" ? data.selftext : "";
    const combined = `${title}\n${selftext}`.trim();
    const post = communityPostSchema.safeParse({
      lane: input.lane,
      platform: "reddit",
      url,
      title,
      author: typeof data.author === "string" ? data.author.slice(0, 80) : "",
      community: typeof data.subreddit === "string" ? `r/${data.subreddit}`.slice(0, 80) : "",
      excerpt: combined.slice(0, 280),
      country: inferCountry(combined, input.markets),
      language: detectLanguage(combined),
      postedAt: typeof data.created_utc === "number" ? new Date(data.created_utc * 1000).toISOString() : null,
      engagement: {
        score: typeof data.score === "number" ? data.score : null,
        comments: typeof data.num_comments === "number" ? data.num_comments : null,
      },
    });
    if (post.success) found.push(post.data);
    if (found.length >= limit) break;
  }
  return found;
}

export async function researchReddit(input: RedditSearchInput): Promise<{ posts: CommunityPost[]; warning: string | null }> {
  if (!config.redditEnabled) return { posts: [], warning: "Reddit research is disabled." };
  try {
    const maxPosts = Math.min(config.redditMaxPosts, input.maxPosts ?? config.redditMaxPosts);
    const subredditFilter = (input.subredditHints ?? [])
      .slice(0, 3)
      .map((name) => name.replace(/^r\//i, "").replace(/[^a-zA-Z0-9_]/g, ""))
      .filter(Boolean)
      .map((name) => `subreddit:${name}`)
      .join(" OR ");
    const query = subredditFilter ? `${input.query} (${subredditFilter})` : input.query;
    const params = new URLSearchParams({
      q: query,
      sort: "relevance",
      t: "year",
      limit: String(config.redditSearchCandidates),
      raw_json: "1",
    });
    const response = await fetch(`https://www.reddit.com/search.json?${params}`, {
      headers: { Accept: "application/json", "User-Agent": config.redditUserAgent },
      signal: AbortSignal.timeout(config.redditTimeoutMs),
    });
    if (!response.ok) return { posts: [], warning: `Reddit search returned HTTP ${response.status}.` };
    const candidates = parseRedditSearch(await response.json(), input, config.redditSearchCandidates);
    const posts = rankRedditPosts(candidates, maxPosts);
    return { posts, warning: posts.length === 0 ? "Reddit search returned no usable posts." : null };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown Reddit search failure";
    return { posts: [], warning: `Reddit search skipped: ${message}` };
  }
}
