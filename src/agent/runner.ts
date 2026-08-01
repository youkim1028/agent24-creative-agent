import { randomUUID } from "node:crypto";
import OpenAI from "openai";
import { config } from "../config.js";
import type { DeckArtifact, DeckSpec } from "../deck/schema.js";
import { traceEvents } from "../events/event-bus.js";
import { AGENT_INSTRUCTIONS } from "./prompt.js";
import { executeTool, toolDefinitions, type ToolContext, type ToolExecution } from "./tools.js";

const MAX_TOOL_ROUNDS = 8;

export interface AgentRequest {
  brief: string;
  slideCount: number;
  language: "ko" | "en";
  fromDate: string | null;
  toDate: string | null;
  allowedHandles: string[];
}

export interface AgentResult {
  runId: string;
  output: string;
  model: string;
  grokModel: string;
  mode: "openai" | "mock";
  xMode: "xai" | "mock";
  rounds: number;
  deck: DeckSpec | null;
  artifact: DeckArtifact | null;
}

export async function runAgent(request: AgentRequest, requestedRunId?: string): Promise<AgentResult> {
  const runId = requestedRunId ?? randomUUID();
  if (config.mockOpenAI) return runMockAgent(request, runId);

  const client = new OpenAI({ apiKey: config.apiKey });
  const input: OpenAI.Responses.ResponseInput = [
    {
      role: "user",
      content:
        `<brief>\n${request.brief}\n</brief>\n\n` +
        `Slide ceiling: ${request.slideCount}\nLanguage: ${request.language}\n` +
        `X date range: ${request.fromDate ?? "not specified"} to ${request.toDate ?? "not specified"}\n` +
        `Allowed X handles: ${request.allowedHandles.join(", ") || "none"}`,
    },
  ];
  let deck: DeckSpec | null = null;
  let artifact: DeckArtifact | null = null;
  const toolContext: ToolContext = { runId };

  traceEvents.emit(runId, "status", {
    state: "started",
    provider: "openai",
    model: config.model,
    reasoning_effort: config.reasoningEffort,
  });

  for (let round = 1; round <= MAX_TOOL_ROUNDS; round += 1) {
    const response = await client.responses.create({
      model: config.model,
      instructions: AGENT_INSTRUCTIONS,
      input,
      tools: toolDefinitions as OpenAI.Responses.Tool[],
      reasoning: { effort: config.reasoningEffort },
      text: { verbosity: "low" },
      store: false,
    });

    input.push(...(response.output as unknown as OpenAI.Responses.ResponseInputItem[]));
    const calls = response.output.filter((item) => item.type === "function_call");

    if (calls.length === 0) {
      traceEvents.emit(runId, "status", { state: "completed", round, rendered: Boolean(artifact) });
      return {
        runId,
        output: response.output_text,
        model: config.model,
        grokModel: config.grokModel,
        mode: "openai",
        xMode: config.mockXai ? "mock" : "xai",
        rounds: round,
        deck,
        artifact,
      };
    }

    for (const call of calls) {
      traceEvents.emit(runId, "tool_call", call);
      const execution = await executeTool(call.name, call.arguments, toolContext);
      deck = execution.deck ?? deck;
      artifact = execution.artifact ?? artifact;
      const resultItem = { type: "function_call_output" as const, call_id: call.call_id, output: execution.output };
      traceEvents.emit(runId, "tool_result", resultItem);
      input.push(resultItem);
    }
  }

  throw new Error(`Agent exceeded the ${MAX_TOOL_ROUNDS}-round safety limit.`);
}

async function runMockTool(context: ToolContext, name: string, args: unknown): Promise<ToolExecution> {
  const { runId } = context;
  const call = {
    type: "function_call",
    call_id: `mock_${randomUUID()}`,
    name,
    arguments: JSON.stringify(args),
  };
  traceEvents.emit(runId, "tool_call", call);
  const execution = await executeTool(name, call.arguments, context);
  traceEvents.emit(runId, "tool_result", {
    type: "function_call_output",
    call_id: call.call_id,
    output: execution.output,
  });
  return execution;
}

function mockDeck(request: AgentRequest, citation: { url: string; title: string; handle: string; excerpt: string }): DeckSpec {
  const title = request.brief.split(/[.!?\n]/)[0]?.trim().slice(0, 54) || "X 대화를 의사결정 자료로";
  const rehearsal = "MOCK REHEARSAL";
  const titleSlide: DeckSpec["slides"][number] = {
    id: "title", archetype: "title", eyebrow: rehearsal, title,
    takeaway: "", bullets: [], stats: [], notes: "API 키 없이 실행한 UI·파이프라인 리허설입니다.", citations: [],
  };
  const contentSlides: DeckSpec["slides"] = [
    {
      id: "signal", archetype: "claim", eyebrow: "SIGNAL", title: "관심보다 검증 요구가 먼저 보인다",
      takeaway: "반응의 핵심은 새로움 자체보다 실제 적용 가능성을 확인하려는 요구다.",
      bullets: ["긍정 반응은 속도와 편의성에 집중", "우려는 출처 신뢰성과 반복 가능한 성과에 집중"], stats: [],
      notes: "실제 발표에서는 XAI_API_KEY로 수집한 게시물만 근거로 사용합니다.", citations: [citation],
    },
    {
      id: "tension", archetype: "two_col", eyebrow: "TENSION", title: "바이럴 신호와 사실 검증은 다른 문제다",
      takeaway: "X 검색은 대화의 방향을 보여주지만, 사실 판단은 별도 근거가 필요하다.",
      bullets: ["X: 무엇이 확산되는가", "검증: 무엇이 사실인가"], stats: [],
      notes: "X 게시물을 시장 반응의 증거로만 취급하는 설계 원칙을 설명합니다.", citations: [citation],
    },
    {
      id: "priority", archetype: "process", eyebrow: "PRIORITY", title: "반복되는 우려가 다음 실험의 순서를 정한다",
      takeaway: "빈도가 높은 질문부터 검증하면 바이럴 반응을 제품 학습으로 바꿀 수 있다.",
      bullets: ["신호 수집", "반응과 사실 분리", "검증 질문 정의", "제품 실험"], stats: [],
      notes: "실제 덱에서는 수집된 출처별로 반복 신호를 묶습니다.", citations: [citation],
    },
  ];
  const closingSlide: DeckSpec["slides"][number] = {
    id: "action", archetype: "closing", eyebrow: "ACTION", title: "반응을 복사하지 말고, 검증할 질문으로 바꿔라",
    takeaway: "Grok은 신호를 찾고 GPT는 논지를 설계하며 코드는 근거 누락을 차단한다.",
    bullets: [], stats: [], notes: "두 공급자와 결정론적 검증기의 역할 분리를 강조합니다.", citations: [citation],
  };
  const contentCount = Math.max(1, Math.min(request.slideCount - 2, contentSlides.length));
  return {
    title,
    subtitle: "GPT × Grok X Search · API keyless rehearsal",
    audience: "해커톤 심사위원",
    thesis: closingSlide.takeaway,
    language: request.language,
    slides: [titleSlide, ...contentSlides.slice(0, contentCount), closingSlide],
  };
}

async function runMockAgent(request: AgentRequest, runId: string): Promise<AgentResult> {
  traceEvents.emit(runId, "status", { state: "started", provider: "openai", mode: "mock" });
  const toolContext: ToolContext = { runId, forceMockX: true };

  const research = await runMockTool(toolContext, "research_x", {
    query: request.brief.slice(0, 240),
    from_date: request.fromDate,
    to_date: request.toDate,
    allowed_x_handles: request.allowedHandles,
  });
  const researchResult = JSON.parse(research.output) as { citations: DeckSpec["slides"][number]["citations"] };

  await runMockTool(toolContext, "review_outline", {
    thesis: "X의 반응은 답이 아니라 검증할 질문을 보여준다.",
    audience: "해커톤 심사위원",
    beats: [
      { position: 1, claim: "관심보다 검증 요구가 먼저 보인다.", evidence_needed: "현재 X 대화" },
      { position: 2, claim: "바이럴 신호와 사실 검증은 분리해야 한다.", evidence_needed: "상반된 X 반응" },
    ],
  });

  const deck = mockDeck(
    request,
    researchResult.citations[0] ?? {
      url: "https://x.com",
      title: "Mock X source — do not present as evidence",
      handle: "@mock",
      excerpt: "MOCK DATA",
    },
  );
  await runMockTool(toolContext, "validate_deck", { deck });
  const rendered = await runMockTool(toolContext, "render_deck", { deck });
  traceEvents.emit(runId, "status", { state: "completed", provider: "openai", mode: "mock" });

  return {
    runId,
    output: "모의 파이프라인이 완료되었습니다. 실제 X 근거를 사용하려면 OPENAI_API_KEY와 XAI_API_KEY를 설정하세요.",
    model: config.model,
    grokModel: config.grokModel,
    mode: "mock",
    xMode: "mock",
    rounds: 4,
    deck,
    artifact: rendered.artifact ?? null,
  };
}
