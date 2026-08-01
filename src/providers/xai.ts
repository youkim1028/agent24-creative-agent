import OpenAI from "openai";
import { config } from "../config.js";
import { traceEvents } from "../events/event-bus.js";
import type { Citation } from "../deck/schema.js";

export interface XSearchInput {
  query: string;
  fromDate: string | null;
  toDate: string | null;
  allowedHandles: string[];
}

export interface XResearchResult {
  ok: boolean;
  mode: "xai" | "mock";
  model: string;
  query: string;
  summary: string;
  citations: Citation[];
  warning: string | null;
}

function collectCitations(value: unknown): Citation[] {
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
      });
    }
    Object.values(record).forEach(visit);
  }
  visit(value);
  return found.slice(0, 12);
}

export async function researchX(input: XSearchInput, runId: string, forceMock = false): Promise<XResearchResult> {
  if (config.mockXai || forceMock) {
    return {
      ok: true,
      mode: "mock",
      model: config.grokModel,
      query: input.query,
      summary:
        "[MOCK X RESEARCH] 초기 반응은 속도와 편의성에 긍정적이지만, 출처 신뢰성과 실제 업무 적용 가능성에 대한 검증 요구가 반복됩니다. 실제 X 근거를 사용하려면 XAI_API_KEY를 설정하세요.",
      citations: [{ url: "https://x.com/xai", title: "Mock X source — do not present as evidence", handle: "@xai", excerpt: "MOCK DATA" }],
      warning: "XAI_API_KEY가 없어 모의 검색 결과를 사용했습니다.",
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
  const response = await client.responses.create({
    model: config.grokModel,
    input: [
      {
        role: "user",
        content:
          `Research this topic on X: ${input.query}\n\n` +
          "Return a compact evidence memo. Separate recurring sentiment from verified fact, note disagreements, and cite specific X post URLs. Use at most eight strong sources.",
      },
    ],
    tools: [tool] as never,
  });

  for (const item of response.output) {
    const type = typeof item.type === "string" ? item.type : "unknown";
    traceEvents.emit(runId, type.includes("search") || type.includes("call") ? "tool_call" : "tool_result", item);
  }

  const citations = collectCitations(response);
  return {
    ok: true,
    mode: "xai",
    model: config.grokModel,
    query: input.query,
    summary: response.output_text,
    citations,
    warning: citations.length === 0 ? "Grok 응답에서 X URL 주석을 추출하지 못했습니다. 수치 주장을 사용하지 마세요." : null,
  };
}
