import OpenAI from "openai";
import { config } from "../config.js";
import { traceEvents } from "../events/event-bus.js";
import { loadResearchMemory, saveResearchMemory } from "../memory/gcs-research.js";
import type { ResearchMarket } from "../research/markets.js";
import type { Citation } from "../deck/schema.js";
import { buildXExtractionPrompt } from "./xai-prompt.js";

export interface XSearchInput {
  query: string;
  markets: ResearchMarket[];
  maxPosts: number;
  fromDate: string | null;
  toDate: string | null;
  allowedHandles: string[];
}

export interface XResearchResult {
  ok: boolean;
  mode: "xai" | "mock";
  model: string;
  query: string;
  markets: ResearchMarket[];
  extract: string;
  citations: Citation[];
  usage: { inputTokens: number; outputTokens: number; totalTokens: number };
  cache: "disabled" | "hit" | "miss";
  warning: string | null;
}

function numberField(record: Record<string, unknown>, names: string[]): number | null {
  for (const name of names) {
    const value = record[name];
    if (typeof value === "number" && Number.isFinite(value) && value >= 0) return value;
  }
  const metrics = record.public_metrics;
  if (metrics && typeof metrics === "object") {
    for (const name of names) {
      const value = (metrics as Record<string, unknown>)[name];
      if (typeof value === "number" && Number.isFinite(value) && value >= 0) return value;
    }
  }
  return null;
}

function dateField(record: Record<string, unknown>): string | null {
  for (const name of ["created_at", "posted_at", "postedAt", "date"]) {
    const value = record[name];
    if (typeof value === "string" && !Number.isNaN(Date.parse(value))) return new Date(value).toISOString();
  }
  return null;
}

function rankCitations(citations: Citation[], limit: number): Citation[] {
  const now = Date.now();
  const score = (citation: Citation): number => {
    const likes = citation.engagement?.likes ?? 0;
    const reposts = citation.engagement?.reposts ?? 0;
    const engagement = Math.min(1, Math.log1p(likes + reposts * 2) / Math.log1p(10_000));
    const ageDays = citation.postedAt ? Math.max(0, (now - Date.parse(citation.postedAt)) / 86_400_000) : 365;
    const recency = ageDays <= 30 ? 1 : ageDays <= 90 ? 0.7 : ageDays <= 365 ? 0.35 : 0;
    return engagement * 0.65 + recency * 0.35;
  };
  return citations
    .map((citation, index) => ({ citation, index }))
    .sort((left, right) => score(right.citation) - score(left.citation) || left.index - right.index)
    .slice(0, limit)
    .map(({ citation }) => citation);
}

function collectCitations(value: unknown, limit: number): Citation[] {
  const found: Citation[] = [];
  const seen = new Set<string>();

  function visit(node: unknown): void {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    const record = node as Record<string, unknown>;
    const url = typeof record.url === "string" ? record.url : null;
    if (url && /^https?:\/\/(?:www\.)?(?:x|twitter)\.com\//i.test(url) && !seen.has(url)) {
      seen.add(url);
      const match = url.match(/(?:x|twitter)\.com\/([^/]+)/i);
      found.push({
        url,
        title: typeof record.title === "string" ? record.title : `X post by @${match?.[1] ?? "unknown"}`,
        handle: match?.[1] ? `@${match[1]}` : "@unknown",
        excerpt: typeof record.text === "string" ? record.text.slice(0, 280) : "",
        postedAt: dateField(record),
        engagement: {
          likes: numberField(record, ["like_count", "likes", "favorite_count", "favourites"]),
          reposts: numberField(record, ["retweet_count", "repost_count", "reposts", "shares"]),
          comments: numberField(record, ["reply_count", "comment_count", "comments"]),
        },
      });
    }
    Object.values(record).forEach(visit);
  }
  visit(value);
  return rankCitations(found, limit);
}

export async function researchX(input: XSearchInput, runId: string, forceMock = false): Promise<XResearchResult> {
  if (config.mockXai || forceMock) {
    return {
      ok: true,
      mode: "mock",
      model: config.grokModel,
      query: input.query,
      markets: input.markets,
      extract:
        "[MOCK X RESEARCH] 초기 반응은 속도와 편의성에 긍정적이지만, 출처 신뢰성과 실제 업무 적용 가능성에 대한 검증 요구가 반복됩니다. 실제 X 근거를 사용하려면 XAI_API_KEY를 설정하세요.",
      citations: [{ url: "https://x.com/xai", title: "Mock X source — do not present as evidence", handle: "@xai", excerpt: "MOCK DATA" }],
      usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      cache: "disabled",
      warning: "XAI_API_KEY가 없어 모의 검색 결과를 사용했습니다.",
    };
  }

  const cached = await loadResearchMemory(input);
  if (cached.record) {
    return {
      ok: true,
      mode: "xai",
      model: config.grokModel,
      query: input.query,
      markets: cached.record.markets,
      extract: cached.record.extract,
      citations: cached.record.citations,
      usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      cache: "hit",
      warning: cached.warning,
    };
  }

  const client = new OpenAI({ apiKey: config.xaiApiKey, baseURL: "https://api.x.ai/v1" });
  const tool: Record<string, unknown> = { type: "x_search" };
  if (input.fromDate) tool.from_date = input.fromDate;
  if (input.toDate) tool.to_date = input.toDate;
  if (input.allowedHandles.length > 0) {
    tool.allowed_x_handles = input.allowedHandles.map((handle) => handle.replace(/^@/, ""));
  }

  traceEvents.emit(runId, "status", { state: "provider_call", provider: "xai", model: config.grokModel });
  const candidateLimit = Math.max(input.maxPosts, Math.ceil(config.xSearchCandidates / 2));
  const response = await client.responses.create({
    model: config.grokModel,
    input: [{ role: "user", content: buildXExtractionPrompt(input, input.maxPosts, candidateLimit) }],
    tools: [tool] as never,
    max_output_tokens: config.grokMaxOutputTokens,
    store: false,
  });

  for (const item of response.output) {
    const type = typeof item.type === "string" ? item.type : "unknown";
    traceEvents.emit(runId, type.includes("search") || type.includes("call") ? "tool_call" : "tool_result", item);
  }

  const citations = collectCitations(response, input.maxPosts);
  const extract = response.output_text.slice(0, 6000);
  const saveWarning = await saveResearchMemory(input, { extract, citations });
  const usage = {
    inputTokens: response.usage?.input_tokens ?? 0,
    outputTokens: response.usage?.output_tokens ?? 0,
    totalTokens: response.usage?.total_tokens ?? 0,
  };
  return {
    ok: true,
    mode: "xai",
    model: config.grokModel,
    query: input.query,
    markets: input.markets,
    extract,
    citations,
    usage,
    cache: config.gcsMemoryEnabled ? "miss" : "disabled",
    warning: [
      cached.warning,
      citations.length === 0 ? "Grok 응답에서 X URL 주석을 추출하지 못했습니다. 수치 주장을 사용하지 마세요." : null,
      saveWarning,
    ].filter(Boolean).join(" ") || null,
  };
}
