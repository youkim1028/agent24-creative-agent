import { randomUUID } from "node:crypto";
import OpenAI from "openai";
import { config } from "../config.js";
import type { DeckEvaluation } from "../deck/evaluate.js";
import { LAYOUT_FAMILY_BY_LAYOUT, type DeckArtifact, type DeckSpec } from "../deck/schema.js";
import { traceEvents } from "../events/event-bus.js";
import { resolveResearchMarkets } from "../research/markets.js";
import { executionForTeamAgent, modelForTeamAgent, runTeamAgent, type TeamAgentRole } from "../team/team-runner.js";
import { AGENT_INSTRUCTIONS } from "./prompt.js";
import { availableToolDefinitions, executeTool, type ToolContext, type ToolExecution } from "./tools.js";

const MAX_TOOL_ROUNDS = 8;

export interface AgentRequest {
  brief: string;
  slideCount: number;
  language: "ko" | "en";
  additionalContext?: string;
  purpose: string;
  audience: string;
  presentationContext: string;
  userVoice: string;
  visualPreference: string;
  targetMarkets: string[];
  fromDate: string | null;
  toDate: string | null;
  allowedHandles: string[];
  uploadedAssetIds?: string[];
  officialImageUrls?: string[];
  designReferenceUrls?: string[];
}

export interface AgentResult {
  runId: string;
  output: string;
  model: string;
  grokModel: string;
  mode: "openai" | "mock";
  architecture: "single" | "team";
  xMode: "xai" | "mock";
  rounds: number;
  deck: DeckSpec | null;
  artifact: DeckArtifact | null;
  evaluation: DeckEvaluation | null;
  // Team runs report the final quality-gate verdict; a failed gate returns the deck
  // spec with artifact: null instead of throwing. Absent on single/mock runs.
  gate?: { passed: boolean; blockers: string[] };
  usage: {
    openai: { inputTokens: number; outputTokens: number; totalTokens: number };
    xai: { inputTokens: number; outputTokens: number; totalTokens: number };
    combinedTotalTokens: number;
    budgetTokens: number;
  };
}

export async function runAgent(request: AgentRequest, requestedRunId?: string): Promise<AgentResult> {
  const runId = requestedRunId ?? randomUUID();
  if (config.mockOpenAI) return runMockAgent(request, runId);
  if (config.agentArchitecture === "team") return runTeamAgent(request, runId);

  const client = new OpenAI({ apiKey: config.apiKey });
  const researchMarkets = resolveResearchMarkets(request.language, request.targetMarkets);
  const input: OpenAI.Responses.ResponseInput = [
    {
      role: "user",
      content:
        `<brief>\n${request.brief}\n</brief>\n\n` +
        `Slide ceiling: ${request.slideCount}\nLanguage: ${request.language}\n` +
        `<user_context>\n` +
        `Additional context: ${request.additionalContext?.trim() || "not supplied"}\n` +
        `Explicit purpose override: ${request.purpose || "not supplied; infer from the brief"}\n` +
        `Explicit audience override: ${request.audience || "not supplied; infer from the brief"}\n` +
        `Explicit presentation context override: ${request.presentationContext || "not supplied; infer from the brief"}\n` +
        `Explicit user voice override: ${request.userVoice || "not supplied; infer from the brief"}\n` +
        `Explicit visual preference override: ${request.visualPreference || "not supplied; infer from the brief"}\n` +
        `</user_context>\n\n` +
        `<research_markets>\n${researchMarkets.map((market) => `${market.country} (${market.searchLanguage})`).join("\n")}\n</research_markets>\n` +
        `X date range: ${request.fromDate ?? "not specified"} to ${request.toDate ?? "not specified"}\n` +
        `Allowed X handles: ${request.allowedHandles.join(", ") || "none"}`,
    },
  ];
  let deck: DeckSpec | null = null;
  let artifact: DeckArtifact | null = null;
  let evaluation: DeckEvaluation | null = null;
  const openaiUsage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
  const xaiUsage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
  const toolContext: ToolContext = { runId };

  traceEvents.emit(runId, "status", {
    state: "started",
    provider: "openai",
    model: config.model,
    reasoning_effort: config.reasoningEffort,
  });

  for (let round = 1; round <= MAX_TOOL_ROUNDS; round += 1) {
    // Only GPT usage draws from the budget; Grok's X-search input tokens are large
    // by design (it bills every post it reads) and bounded by its own caps.
    if (openaiUsage.totalTokens >= config.agentMaxTotalTokens) {
      throw new Error(`GPT token budget reached before round ${round}. Increase AGENT_MAX_TOTAL_TOKENS only after reviewing the trace.`);
    }
    const response = await client.responses.create({
      model: config.model,
      instructions: AGENT_INSTRUCTIONS,
      input,
      tools: availableToolDefinitions(toolContext) as OpenAI.Responses.Tool[],
      reasoning: { effort: config.reasoningEffort },
      text: { verbosity: "low" },
      include: ["reasoning.encrypted_content"],
      max_output_tokens: config.openaiMaxOutputTokens,
      store: false,
    });

    openaiUsage.inputTokens += response.usage?.input_tokens ?? 0;
    openaiUsage.outputTokens += response.usage?.output_tokens ?? 0;
    openaiUsage.totalTokens += response.usage?.total_tokens ?? 0;
    traceEvents.emit(runId, "status", {
      state: "usage",
      provider: "openai",
      round,
      usage: { ...openaiUsage },
      budget_tokens: config.agentMaxTotalTokens,
    });

    // store:false continuation must replay the encrypted reasoning item alongside
    // function calls, so request it explicitly and carry every output item forward.
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
        architecture: "single",
        xMode: config.mockXai ? "mock" : "xai",
        rounds: round,
        deck,
        artifact,
        evaluation,
        usage: {
          openai: openaiUsage,
          xai: xaiUsage,
          combinedTotalTokens: openaiUsage.totalTokens + xaiUsage.totalTokens,
          budgetTokens: config.agentMaxTotalTokens,
        },
      };
    }

    for (const call of calls) {
      traceEvents.emit(runId, "tool_call", call);
      const execution = await executeTool(call.name, call.arguments, toolContext);
      deck = execution.deck ?? deck;
      artifact = execution.artifact ?? artifact;
      evaluation = execution.evaluation ?? evaluation;
      if (execution.usage) {
        xaiUsage.inputTokens += execution.usage.inputTokens;
        xaiUsage.outputTokens += execution.usage.outputTokens;
        xaiUsage.totalTokens += execution.usage.totalTokens;
      }
      const resultItem = { type: "function_call_output" as const, call_id: call.call_id, output: execution.output };
      traceEvents.emit(runId, "tool_result", resultItem);
      input.push(resultItem);
    }

    if (artifact) {
      traceEvents.emit(runId, "status", { state: "completed", round, rendered: true });
      return {
        runId,
        output: request.language === "ko"
          ? `검증·평가를 통과한 PPTX가 생성되었습니다: ${artifact.downloadUrl} 한계: X 게시물은 대화의 증거이며 사실의 자동 증명은 아닙니다.`
          : `The validated and evaluated PPTX is ready: ${artifact.downloadUrl} Caveat: X posts evidence conversation, not automatic factual truth.`,
        model: config.model,
        grokModel: config.grokModel,
        mode: "openai",
        architecture: "single",
        xMode: config.mockXai ? "mock" : "xai",
        rounds: round,
        deck,
        artifact,
        evaluation,
        usage: {
          openai: openaiUsage,
          xai: xaiUsage,
          combinedTotalTokens: openaiUsage.totalTokens + xaiUsage.totalTokens,
          budgetTokens: config.agentMaxTotalTokens,
        },
      };
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

function emitMockAgentRole(runId: string, agent: TeamAgentRole, input: unknown, output: unknown): void {
  const stage = "initial";
  const request = {
    model: modelForTeamAgent(agent),
    reasoning: { effort: executionForTeamAgent(agent).reasoningEffort },
    service_tier: executionForTeamAgent(agent).serviceTier,
    input: [{ role: "user", content: JSON.stringify(input) }],
    mock: true,
  };
  traceEvents.emit(runId, "tool_call", { type: "agent_call", agent, stage, request });
  traceEvents.emit(runId, "tool_result", {
    type: "agent_result",
    agent,
    stage,
    status: "completed",
    mock: true,
    output_text: JSON.stringify(output),
    output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text: JSON.stringify(output) }] }],
  });
}

function mockDeck(
  request: AgentRequest,
  citation: { url: string; title: string; handle: string; excerpt: string },
  presentationProfile: { audience: string; visualPreference: string },
): DeckSpec {
  const title = request.brief.split(/[.!?\n]/)[0]?.trim().slice(0, 54) || "X 대화를 의사결정 자료로";
  const rehearsal = "MOCK REHEARSAL";
  const directive = (
    layout: DeckSpec["slides"][number]["visualDirective"]["layout"],
    composition: string,
    emphasis: string,
  ): DeckSpec["slides"][number]["visualDirective"] => {
    const metadata: Record<typeof layout, Pick<DeckSpec["slides"][number]["visualDirective"], "dominantVisual" | "informationShape">> = {
      hero: { dominantVisual: "headline", informationShape: "declaration" },
      statement: { dominantVisual: "headline", informationShape: "synthesis" },
      image_focus: { dominantVisual: "image", informationShape: "evidence" },
      image_left: { dominantVisual: "image", informationShape: "evidence" },
      evidence_focus: { dominantVisual: "evidence", informationShape: "evidence" },
      split: { dominantVisual: "comparison", informationShape: "comparison" },
      steps: { dominantVisual: "sequence", informationShape: "sequence" },
      chart_focus: { dominantVisual: "data", informationShape: "comparison" },
      diagram_flow: { dominantVisual: "relationship", informationShape: "sequence" },
      timeline: { dominantVisual: "sequence", informationShape: "chronology" },
      spatial_map: { dominantVisual: "relationship", informationShape: "spatial" },
    };
    return {
      layout,
      layoutFamily: LAYOUT_FAMILY_BY_LAYOUT[layout],
      ...metadata[layout],
      composition,
      visualAssetType: "none",
      imageNeed: "none",
      emphasis,
      avoid: ["decorative AI imagery"],
    };
  };
  const titleSlide: DeckSpec["slides"][number] = {
    id: "title", archetype: "title", visualRole: "declaration", visualDirective: directive("hero", "Left-aligned declaration", "title"), eyebrow: rehearsal, title,
    takeaway: "", bullets: [], stats: [], notes: "API 키 없이 실행한 UI·파이프라인 리허설입니다.", citations: [],
  };
  const contentSlides: DeckSpec["slides"] = [
    {
      id: "signal", archetype: "claim", visualRole: "evidence", visualDirective: directive("evidence_focus", "Lead with the sourced complaint", "source excerpt"), eyebrow: "SIGNAL", title: "관심보다 검증 요구가 먼저 보인다",
      takeaway: "반응의 핵심은 새로움 자체보다 실제 적용 가능성을 확인하려는 요구다.",
      bullets: ["긍정 반응은 속도와 편의성에 집중", "우려는 출처 신뢰성과 반복 가능한 성과에 집중"], stats: [],
      notes: "실제 발표에서는 XAI_API_KEY로 수집한 게시물만 근거로 사용합니다.", citations: [citation],
    },
    {
      id: "tension", archetype: "two_col", visualRole: "explanation", visualDirective: directive("split", "Contrast signal and verification", "difference"), eyebrow: "TENSION", title: "바이럴 신호와 사실 검증은 다른 문제다",
      takeaway: "X 검색은 대화의 방향을 보여주지만, 사실 판단은 별도 근거가 필요하다.",
      bullets: ["X: 무엇이 확산되는가", "검증: 무엇이 사실인가"], stats: [],
      notes: "X 게시물을 시장 반응의 증거로만 취급하는 설계 원칙을 설명합니다.", citations: [citation],
    },
    {
      id: "priority", archetype: "process", visualRole: "action", visualDirective: directive("steps", "Show the decision sequence", "next experiment"), eyebrow: "PRIORITY", title: "반복되는 우려가 다음 실험의 순서를 정한다",
      takeaway: "빈도가 높은 질문부터 검증하면 바이럴 반응을 제품 학습으로 바꿀 수 있다.",
      bullets: ["신호 수집", "반응과 사실 분리", "검증 질문 정의", "제품 실험"], stats: [],
      notes: "실제 덱에서는 수집된 출처별로 반복 신호를 묶습니다.", citations: [citation],
    },
  ];
  const closingSlide: DeckSpec["slides"][number] = {
    id: "action", archetype: "closing", visualRole: "synthesis", visualDirective: directive("statement", "Resolve with one action", "action"), eyebrow: "ACTION", title: "반응을 복사하지 말고, 검증할 질문으로 바꿔라",
    takeaway: "Grok은 신호를 찾고 GPT는 논지를 설계하며 코드는 근거 누락을 차단한다.",
    bullets: [], stats: [], notes: "두 공급자와 결정론적 검증기의 역할 분리를 강조합니다.", citations: [citation],
  };
  const contentCount = Math.max(1, Math.min(request.slideCount - 2, contentSlides.length));
  return {
    title,
    subtitle: "GPT × Grok X Search · API keyless rehearsal",
    audience: presentationProfile.audience,
    thesis: closingSlide.takeaway,
    language: request.language,
    aestheticIntent: {
      theme: "ink_acid",
      rationale: `Mock rehearsal applies the resolved direction: ${presentationProfile.visualPreference}`,
      mood: "focused and analytical",
      layoutLogic: "One claim per slide with restrained evidence blocks.",
      imageLogic: "No images in mock mode; do not imply visual research was performed.",
      avoid: ["decorative AI imagery", "unverified visual metaphors"],
    },
    slides: [titleSlide, ...contentSlides.slice(0, contentCount), closingSlide],
  };
}

async function runMockAgent(request: AgentRequest, runId: string): Promise<AgentResult> {
  traceEvents.emit(runId, "status", { state: "started", provider: "openai", mode: "mock" });
  const toolContext: ToolContext = { runId, forceMockX: true };
  const teamRehearsal = config.agentArchitecture === "team";
  const plan = {
    presentationProfile: {
      purpose: request.purpose.trim() || "Turn community signals into a reviewable decision deck.",
      audience: request.audience.trim() || (request.language === "ko" ? "주제에 익숙하지 않은 의사결정자" : "Decision-makers new to the topic"),
      presentationContext: request.presentationContext.trim() || (request.language === "ko" ? "짧은 라이브 발표" : "Short live presentation"),
      userVoice: request.userVoice.trim() || (request.language === "ko" ? "명확하고 근거 중심" : "Clear and evidence-led"),
      visualPreference: request.visualPreference.trim() || (request.language === "ko" ? "주제에 맞는 절제된 편집 디자인" : "Restrained editorial design fitted to the topic"),
      assumptions: ["Mock mode uses conservative defaults because no model inference is performed."],
    },
    topicQuery: "complaints about the writing of AI-generated presentations: generic copy, filler slides, robotic tone",
    designCritiqueQuery: "criticism of the look of AI-generated presentations: repetitive layouts, template feel, AI styling",
    topicKeywordQuery: "AI presentation generator problems",
    designCritiqueKeywordQuery: "AI slide design criticism",
    markets: resolveResearchMarkets(request.language, request.targetMarkets),
    rationale: "Mock rehearsal keeps topic and design-critique evidence in separate lanes.",
  };
  if (teamRehearsal) {
    emitMockAgentRole(runId, "research_planner", { request }, plan);
    traceEvents.emit(runId, "status", {
      state: "presentation_context_resolved",
      presentation_profile: plan.presentationProfile,
      additional_context_used: Boolean(request.additionalContext?.trim()),
      mock: true,
    });
    traceEvents.emit(runId, "status", {
      state: "agent_handoff",
      from: "research_planner",
      to: "x_youtube_hn_retrieval_tools",
      contract: "ResearchPlan",
      mock: true,
    });
  }

  const research = await runMockTool(toolContext, "research_x", {
    query: request.brief.slice(0, 240),
    lane: "topic",
    markets: resolveResearchMarkets(request.language, request.targetMarkets).map((market) => ({
      country: market.country,
      search_language: market.searchLanguage,
    })),
    from_date: request.fromDate,
    to_date: request.toDate,
    allowed_x_handles: request.allowedHandles,
  });
  const researchResult = JSON.parse(research.output) as { citations: DeckSpec["slides"][number]["citations"] };

  const mockYouTubePost = {
    lane: "design_critique" as const,
    platform: "youtube" as const,
    url: "https://www.youtube.com/watch?v=mock&lc=mock-comment",
    title: "Mock YouTube source — do not present as evidence",
    author: "mock_user",
    community: "YouTube · mock channel",
    excerpt: "MOCK DATA: repeated layouts make generated decks feel interchangeable.",
    country: "",
    language: "en",
    postedAt: null,
    engagement: { likes: null, reposts: null, score: null, comments: null },
  };
  const mockHackerNewsPost = {
    lane: "topic" as const,
    platform: "hacker_news" as const,
    url: "https://news.ycombinator.com/item?id=99999999",
    title: "Mock Hacker News source — do not present as evidence",
    author: "mock_builder",
    community: "Hacker News",
    excerpt: "MOCK DATA: teams want clearer provenance from generated presentation tools.",
    country: "",
    language: "en",
    postedAt: null,
    engagement: { likes: null, reposts: null, score: 12, comments: 4 },
  };
  if (teamRehearsal) {
    const youtubeInput = {
      lane: "design_critique",
      query: plan.designCritiqueQuery,
      markets: plan.markets,
      fromDate: request.fromDate,
      toDate: request.toDate,
      mock: true,
    };
    traceEvents.emit(runId, "tool_call", { type: "youtube_search", input: youtubeInput });
    traceEvents.emit(runId, "tool_result", {
      type: "youtube_search_result",
      lane: "design_critique",
      posts: [mockYouTubePost],
      videosExamined: 1,
      calls: 0,
      cache: "disabled",
      warning: "Mock rehearsal data must not be presented as evidence.",
      mock: true,
    });
    traceEvents.emit(runId, "tool_call", {
      type: "hacker_news_search",
      input: { lane: "topic", query: plan.topicQuery, markets: plan.markets, fromDate: request.fromDate, toDate: request.toDate, mock: true },
    });
    traceEvents.emit(runId, "tool_result", {
      type: "hacker_news_search_result",
      lane: "topic",
      posts: [mockHackerNewsPost],
      candidatesExamined: 1,
      calls: 0,
      cache: "disabled",
      warning: "Mock rehearsal data must not be presented as evidence.",
      mock: true,
    });
  }

  if (!teamRehearsal) await runMockTool(toolContext, "review_outline", {
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
    plan.presentationProfile,
  );
  if (teamRehearsal) {
    const xCitation = researchResult.citations[0] ?? {
      url: "https://x.com/xai",
      title: "Mock X source — do not present as evidence",
      handle: "@xai",
      excerpt: "MOCK DATA",
    };
    const sourceUrl = xCitation.url;
    const mockXPost = {
      lane: "topic" as const,
      platform: "x" as const,
      url: xCitation.url,
      title: xCitation.title,
      author: xCitation.handle,
      community: "X",
      excerpt: xCitation.excerpt,
      country: xCitation.country ?? "",
      language: xCitation.language ?? request.language,
      postedAt: xCitation.postedAt ?? null,
      engagement: {
        likes: xCitation.engagement?.likes ?? null,
        reposts: xCitation.engagement?.reposts ?? null,
        score: xCitation.engagement?.score ?? null,
        comments: xCitation.engagement?.comments ?? null,
      },
    };
    traceEvents.emit(runId, "status", {
      state: "community_research_handoff",
      type: "community_research_result",
      posts: [mockXPost, mockYouTubePost, mockHackerNewsPost],
      source_catalog: [xCitation, {
        url: mockYouTubePost.url,
        title: mockYouTubePost.title,
        handle: mockYouTubePost.author,
        excerpt: mockYouTubePost.excerpt,
      }, {
        url: mockHackerNewsPost.url,
        title: mockHackerNewsPost.title,
        handle: mockHackerNewsPost.author,
        excerpt: mockHackerNewsPost.excerpt,
      }],
      memory: {
        enabled: false,
        x: { topic: "disabled", design_critique: "disabled" },
        youtube: { topic: "disabled", design_critique: "disabled" },
        hacker_news: { topic: "disabled", design_critique: "disabled" },
      },
      warnings: ["Mock rehearsal data must not be presented as evidence."],
      mock: true,
    });
    traceEvents.emit(runId, "status", {
      state: "agent_handoff",
      from: "x_youtube_hn_retrieval_tools",
      to: "evidence_analyst",
      contract: "CommunityPost[]",
      mock: true,
    });
    const evidence = {
      topicComplaints: [{ complaint: "MOCK: 실제 적용 가능성 검증 요구", sourceUrls: [sourceUrl], countries: [], languages: [request.language], confidence: "low" }],
      designComplaints: [{ complaint: "MOCK: 반복 레이아웃 비판", sourceUrls: [mockYouTubePost.url], countries: [], languages: ["en"], confidence: "low" }],
      designCliches: ["decorative AI imagery"],
      rubric: [{
        criterion: "MOCK: 슬라이드마다 서로 다른 주장과 실루엣을 가져야 하며 레이아웃이 반복되면 안 된다",
        derivedFrom: "MOCK: 반복 레이아웃 비판",
        sourceUrls: [mockYouTubePost.url],
        category: "design",
        severity: "error",
      }],
      regionalDifferences: [],
      contradictions: [],
      sourceLimitations: ["Mock rehearsal data must not be presented as evidence."],
    };
    const narrative = {
      title: deck.title,
      subtitle: deck.subtitle,
      audience: deck.audience,
      thesis: deck.thesis,
      language: deck.language,
      slides: deck.slides.map((slide) => ({
        id: slide.id,
        visualRole: slide.visualRole,
        claim: slide.title,
        purpose: slide.takeaway || slide.title,
        visiblePoints: slide.bullets,
        presenterNote: slide.notes,
      })),
    };
    const visualSystem = {
      aestheticIntent: deck.aestheticIntent,
      slideDirectives: deck.slides.map((slide) => ({ slideId: slide.id, ...slide.visualDirective })),
    };
    emitMockAgentRole(runId, "evidence_analyst", { plan, mockResearch: true }, evidence);
    traceEvents.emit(runId, "status", { state: "agent_handoff", from: "evidence_analyst", to: "art_director", contract: "CommunityEvidence (evaluation rubric)", mock: true });
    emitMockAgentRole(runId, "narrative_architect", { evidence }, narrative);
    traceEvents.emit(runId, "status", { state: "agent_handoff", from: "narrative_architect", to: "art_director", contract: "NarrativeSpec", mock: true });
    emitMockAgentRole(runId, "art_director", { narrative }, visualSystem);
    traceEvents.emit(runId, "status", { state: "agent_handoff", from: "art_director", to: "visual_asset_tools", contract: "VisualSystemSpec", mock: true });
    traceEvents.emit(runId, "status", { state: "image_retrieval_complete", selected_count: 0, search_calls: 0, warnings: [], mock: true });
    traceEvents.emit(runId, "status", { state: "visual_assets_resolved", external_assets: 0, native_charts_planned: 0, native_diagrams_planned: 0, warnings: [], mock: true });
    traceEvents.emit(runId, "status", { state: "agent_handoff", from: "visual_asset_tools", to: "deck_composer", contract: "VisualAssetPlan", mock: true });
    emitMockAgentRole(runId, "deck_composer", { narrative, visualSystem }, deck);
    traceEvents.emit(runId, "status", { state: "agent_handoff", from: "deck_composer", to: "independent_critic", contract: "DeckSpec", mock: true });
    emitMockAgentRole(runId, "independent_critic", { deck }, {
      verdict: "pass",
      scores: { grounding: 70, narrative: 80, topicAestheticFit: 80, userVoice: 75, antiCliche: 80 },
      issues: [],
      summary: "Mock contract rehearsal only; live evidence quality was not judged.",
    });
    traceEvents.emit(runId, "status", { state: "agent_handoff", from: "independent_critic", to: "deterministic_quality_gates", contract: "CritiqueReport", mock: true });
  }
  await runMockTool(toolContext, "validate_deck", { deck });
  const evaluationResult = await runMockTool(toolContext, "evaluate_deck", {});
  const rendered = await runMockTool(toolContext, "render_deck", {});
  traceEvents.emit(runId, "status", { state: "completed", provider: "openai", mode: "mock" });

  return {
    runId,
    output: "모의 파이프라인이 완료되었습니다. 실제 X 근거를 사용하려면 OPENAI_API_KEY와 XAI_API_KEY를 설정하세요.",
    model: config.model,
    grokModel: config.grokModel,
    mode: "mock",
    architecture: config.agentArchitecture,
    xMode: "mock",
    rounds: teamRehearsal ? 6 : 5,
    deck,
    artifact: rendered.artifact ?? null,
    evaluation: evaluationResult.evaluation ?? null,
    usage: {
      openai: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      xai: research.usage ?? { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      combinedTotalTokens: research.usage?.totalTokens ?? 0,
      budgetTokens: config.agentMaxTotalTokens,
    },
  };
}
