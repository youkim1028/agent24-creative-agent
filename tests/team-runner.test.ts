import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentRequest } from "../src/agent/runner.js";
import { config } from "../src/config.js";
import type { DeckSpec } from "../src/deck/schema.js";
import { traceEvents, type TraceEvent } from "../src/events/event-bus.js";

const state = vi.hoisted(() => ({ queue: [] as unknown[], requests: [] as any[] }));

vi.mock("openai", () => ({
  default: class {
    responses = {
      create: async (request: unknown) => {
        state.requests.push(request);
        const next = state.queue.shift();
        if (!next) throw new Error("No queued model response for this call.");
        return next;
      },
    };
  },
}));

vi.mock("../src/providers/xai.js", () => ({
  researchX: vi.fn(async (input: { query: string; markets: unknown[] }) => ({
    ok: true,
    mode: "xai",
    model: "grok-4.5",
    query: input.query,
    markets: input.markets,
    extract: "post extract",
    citations: [{ url: "https://x.com/creator/status/1", title: "Creator complaint", handle: "@creator", excerpt: "The output all looks the same." }],
    usage: { inputTokens: 5, outputTokens: 5, totalTokens: 10 },
    cache: "disabled",
    warning: null,
  })),
}));

vi.mock("../src/providers/youtube.js", () => ({
  researchYouTube: vi.fn(async () => ({
    type: "youtube_search_result",
    posts: [],
    videosExamined: 0,
    calls: 0,
    cache: "disabled",
    warning: "YouTube search returned no usable public comments.",
  })),
}));

vi.mock("../src/providers/hacker-news.js", () => ({
  researchHackerNews: vi.fn(async () => ({
    type: "hacker_news_search_result",
    posts: [],
    candidatesExamined: 0,
    calls: 0,
    cache: "disabled",
    warning: null,
  })),
}));

vi.mock("../src/deck/render.js", () => ({
  renderDeck: vi.fn(async () => ({
    filename: "deck.pptx",
    jsonFilename: "deck.json",
    downloadUrl: "/api/artifacts/deck.pptx",
    jsonUrl: "/api/artifacts/deck.json",
  })),
}));

const { runTeamAgent, TEAM_AGENT_ROLES } = await import("../src/team/team-runner.js");

const SOURCE_URL = "https://x.com/creator/status/1";

function reply(payload: unknown): unknown {
  return {
    status: "completed",
    incomplete_details: null,
    usage: { input_tokens: 10, output_tokens: 10, total_tokens: 20 },
    output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text: JSON.stringify(payload) }] }],
    output_text: JSON.stringify(payload),
  };
}

function request(): AgentRequest {
  return {
    brief: "AI 영상 도구에 대한 크리에이터 반응",
    slideCount: 3,
    language: "ko",
    purpose: "다음 기능 우선순위 결정",
    audience: "서비스 기획팀",
    presentationContext: "내부 검토 회의",
    userVoice: "직설적이고 근거 중심",
    visualPreference: "절제된 편집 디자인",
    targetMarkets: [],
    fromDate: null,
    toDate: null,
    allowedHandles: [],
  };
}

const plan = {
  presentationProfile: {
    purpose: "다음 기능 우선순위 결정",
    audience: "서비스 기획팀",
    presentationContext: "내부 검토 회의",
    userVoice: "직설적이고 근거 중심",
    visualPreference: "절제된 편집 디자인",
    assumptions: [],
  },
  topicQuery: "AI video tool creator complaints",
  designCritiqueQuery: "AI generated slide design criticism",
  topicKeywordQuery: "AI video tool problems",
  designCritiqueKeywordQuery: "AI slide design criticism",
  markets: [{ country: "South Korea", searchLanguage: "ko" }],
  rationale: "Split subject friction from design criticism.",
};

const evidence = {
  topicComplaints: [{
    complaint: "결과물이 서로 비슷해서 검수 시간이 늘어난다",
    sourceUrls: [SOURCE_URL],
    countries: ["South Korea"],
    languages: ["ko"],
    confidence: "medium" as const,
  }],
  designComplaints: [{
    complaint: "AI 슬라이드는 레이아웃이 반복된다",
    sourceUrls: [SOURCE_URL],
    countries: ["South Korea"],
    languages: ["ko"],
    confidence: "low" as const,
  }],
  designCliches: ["네온 그라디언트"],
  rubric: [{
    criterion: "슬라이드 레이아웃이 반복되면 안 되고 각 장이 고유한 주장을 가져야 한다",
    derivedFrom: "AI 슬라이드는 레이아웃이 반복된다",
    sourceUrls: [SOURCE_URL],
    category: "design" as const,
    severity: "error" as const,
  }],
  regionalDifferences: [],
  contradictions: [],
  sourceLimitations: ["YouTube 댓글 검색이 결과를 반환하지 않았습니다."],
};

const narrative = {
  title: "반응을 검증할 질문으로",
  subtitle: "크리에이터 대화에서 다음 실험을 고른다",
  audience: "서비스 기획팀",
  thesis: "반복되는 불만이 다음 실험의 순서를 정한다",
  language: "ko" as const,
  slides: [
    { id: "title", visualRole: "declaration" as const, claim: "반응을 검증할 질문으로", purpose: "방향 선언", visiblePoints: [], presenterNote: "오프닝" },
    { id: "signal", visualRole: "evidence" as const, claim: "검수 시간이 늘었다는 불만이 반복된다", purpose: "근거 제시", visiblePoints: ["결과물 유사성", "검수 부담"], presenterNote: "대화의 증거일 뿐" },
    { id: "action", visualRole: "synthesis" as const, claim: "검수 부담부터 실험하라", purpose: "행동 제안", visiblePoints: [], presenterNote: "마무리" },
  ],
};

const visualSystem = {
  aestheticIntent: {
    theme: "editorial_light" as const,
    rationale: "내부 검토 회의에서는 장식보다 읽히는 대비가 필요하다.",
    mood: "차분하고 분석적",
    layoutLogic: "슬라이드당 하나의 주장과 근거 블록",
    imageLogic: "주장을 설명하지 못하는 이미지는 넣지 않는다",
    avoid: ["네온 그라디언트"],
  },
  slideDirectives: [
    { slideId: "title", layout: "hero" as const, layoutFamily: "opening_hero" as const, dominantVisual: "headline" as const, informationShape: "declaration" as const, composition: "왼쪽 정렬 선언", visualAssetType: "none" as const, imageNeed: "none" as const, emphasis: "제목", avoid: ["장식 아이콘"] },
    { slideId: "signal", layout: "evidence_focus" as const, layoutFamily: "evidence_list" as const, dominantVisual: "evidence" as const, informationShape: "evidence" as const, composition: "인용 중심 구성", visualAssetType: "none" as const, imageNeed: "none" as const, emphasis: "근거", avoid: ["차트 남용"] },
    { slideId: "action", layout: "statement" as const, layoutFamily: "closing_statement" as const, dominantVisual: "headline" as const, informationShape: "synthesis" as const, composition: "단문 마무리", visualAssetType: "none" as const, imageNeed: "none" as const, emphasis: "행동", avoid: ["요약 나열"] },
  ],
};

function deck(): DeckSpec {
  const citation = { url: SOURCE_URL, title: "Creator complaint", handle: "@creator", excerpt: "The output all looks the same." };
  return {
    title: "반응을 검증할 질문으로",
    subtitle: "크리에이터 대화에서 다음 실험을 고른다",
    audience: "서비스 기획팀",
    thesis: "반복되는 불만이 다음 실험의 순서를 정한다",
    language: "ko",
    aestheticIntent: visualSystem.aestheticIntent,
    slides: [
      { id: "title", archetype: "title", visualRole: "declaration", visualDirective: { layout: "hero", layoutFamily: "opening_hero", dominantVisual: "headline", informationShape: "declaration", composition: "왼쪽 정렬 선언", visualAssetType: "none", imageNeed: "none", emphasis: "제목", avoid: ["장식 아이콘"] }, eyebrow: "SIGNAL", title: "반응을 검증할 질문으로", takeaway: "", bullets: [], stats: [], notes: "오프닝", citations: [] },
      { id: "signal", archetype: "claim", visualRole: "evidence", visualDirective: { layout: "evidence_focus", layoutFamily: "evidence_list", dominantVisual: "evidence", informationShape: "evidence", composition: "인용 중심 구성", visualAssetType: "none", imageNeed: "none", emphasis: "근거", avoid: ["차트 남용"] }, eyebrow: "EVIDENCE", title: "검수 시간이 늘었다는 불만이 반복된다", takeaway: "결과물 유사성이 검수 부담으로 이어진다.", bullets: ["결과물 유사성", "검수 부담"], stats: [], notes: "대화의 증거일 뿐", citations: [citation] },
      { id: "action", archetype: "closing", visualRole: "synthesis", visualDirective: { layout: "statement", layoutFamily: "closing_statement", dominantVisual: "headline", informationShape: "synthesis", composition: "단문 마무리", visualAssetType: "none", imageNeed: "none", emphasis: "행동", avoid: ["요약 나열"] }, eyebrow: "ACTION", title: "검수 부담부터 실험하라", takeaway: "반복되는 불만이 다음 실험의 순서를 정한다.", bullets: [], stats: [], notes: "마무리", citations: [citation] },
    ],
  };
}

function critique(verdict: "pass" | "revise") {
  return {
    verdict,
    scores: { grounding: 80, narrative: 80, topicAestheticFit: 80, userVoice: 80, antiCliche: 80 },
    issues: verdict === "revise"
      ? [{ category: "cliche" as const, severity: "error" as const, slideId: "signal", instruction: "구체적인 불만 표현으로 바꿔라." }]
      : [],
    summary: verdict === "pass" ? "근거와 구조가 일관된다." : "일부 문구가 일반적이다.",
  };
}

function captureEvents(): { events: TraceEvent[]; stop: () => void } {
  const events: TraceEvent[] = [];
  const stop = traceEvents.subscribe((event) => events.push(event));
  return { events, stop };
}

beforeEach(() => {
  state.queue = [];
  state.requests = [];
  traceEvents.clear();
});

describe("team pipeline runtime", () => {
  it("streams the verbatim model request and response for every role", async () => {
    state.queue = [plan, evidence, narrative, visualSystem, deck(), critique("pass")].map(reply);
    const captured = captureEvents();

    await runTeamAgent(request(), "raw-trace");
    captured.stop();

    const call = captured.events.find((event) => (event.payload as any)?.type === "agent_call");
    const callPayload = call?.payload as any;
    expect(call?.type).toBe("tool_call");
    // The event must carry the request itself, not a description of it.
    expect(callPayload.request).toEqual(state.requests[0]);
    expect(callPayload.request.instructions).toContain("Research Planner");
    expect(JSON.parse(callPayload.request.input[0].content).brief).toBe(request().brief);

    const result = captured.events.find((event) => (event.payload as any)?.type === "agent_result");
    const resultPayload = result?.payload as any;
    expect(result?.type).toBe("tool_result");
    expect(JSON.parse(resultPayload.output_text)).toEqual(plan);
    expect(resultPayload.output).toEqual(reply(plan as unknown as Record<string, unknown>).output);

    const resolvedContext = captured.events.find((event) => (event.payload as any)?.state === "presentation_context_resolved");
    expect((resolvedContext?.payload as any)?.presentation_profile).toEqual(plan.presentationProfile);

    const initialRoles = captured.events
      .filter((event) => (event.payload as any)?.type === "agent_call" && (event.payload as any)?.stage === "initial")
      .map((event) => (event.payload as any).agent);
    expect(initialRoles).toEqual(TEAM_AGENT_ROLES);
    // Pin the routing, not env-specific literals: the composer follows the
    // critical model + standard effort knobs, and only the narrative architect
    // uses the deep-effort knob.
    const composerCall = captured.events.find((event) => (event.payload as any)?.type === "agent_call" && (event.payload as any)?.agent === "deck_composer");
    expect((composerCall?.payload as any).request.model).toBe(config.criticalModel);
    expect((composerCall?.payload as any).request.reasoning).toEqual({ effort: config.standardReasoningEffort });
    expect((composerCall?.payload as any).request.service_tier).toBe(config.criticalServiceTier);
    expect((composerCall?.payload as any).request.max_output_tokens).toBe(config.teamRoleTokenLimits.composer);
    const narrativeCall = captured.events.find((event) => (event.payload as any)?.type === "agent_call" && (event.payload as any)?.agent === "narrative_architect");
    expect((narrativeCall?.payload as any).request.reasoning).toEqual({ effort: config.criticalReasoningEffort });
    expect((narrativeCall?.payload as any).request.max_output_tokens).toBe(config.teamRoleTokenLimits.narrative);

    // OpenAI strict json_schema 400s on format:"uri"; zod .url() must not leak it.
    expect(JSON.stringify(state.requests)).not.toContain('"format":"uri"');
    // Strict mode also demands every property in `required`: optional fields like
    // the art director's imageIntent must be emitted as required-but-nullable.
    const artDirectorRequest = state.requests.find((req) => req.text?.format?.name === "visual_system_spec");
    const directiveItems = artDirectorRequest?.text?.format?.schema?.properties?.slideDirectives?.items;
    expect(directiveItems?.required).toContain("imageIntent");
    expect(directiveItems?.required).toContain("visualAssetType");
    expect(directiveItems?.required).toEqual(expect.arrayContaining(["layoutFamily", "dominantVisual", "informationShape"]));
    // YouTube/HN keyword search gets the short keyword queries, not the semantic X sentences.
    const youtube = await import("../src/providers/youtube.js");
    const youtubeQueries = vi.mocked(youtube.researchYouTube).mock.calls.map(([input]) => (input as { query: string }).query);
    expect(youtubeQueries).toEqual(expect.arrayContaining(["AI video tool problems", "AI slide design criticism"]));

    const handoffs = captured.events
      .filter((event) => (event.payload as any)?.state === "agent_handoff")
      .map((event) => `${(event.payload as any).from}->${(event.payload as any).to}`);
    expect(handoffs).toEqual([
      "research_planner->x_youtube_hn_retrieval_tools",
      "x_youtube_hn_retrieval_tools->evidence_analyst",
      "evidence_analyst->art_director",
      "narrative_architect->art_director",
      "art_director->visual_asset_tools",
      "visual_asset_tools->deck_composer",
      "deck_composer->independent_critic",
      "independent_critic->deterministic_quality_gates",
    ]);
  });

  it("publishes the collected community posts, not just their count", async () => {
    state.queue = [plan, evidence, narrative, visualSystem, deck(), critique("pass")].map(reply);
    const captured = captureEvents();

    await runTeamAgent(request(), "research-trace");
    captured.stop();

    const research = captured.events.find((event) => (event.payload as any)?.type === "community_research_result");
    const payload = research?.payload as any;
    expect(payload.posts).toHaveLength(1);
    expect(new Set(payload.posts.map((post: { url: string }) => post.url)).size).toBe(payload.posts.length);
    expect(payload.source_catalog[0].url).toBe(SOURCE_URL);
    expect(payload.warnings).toContain("YouTube search returned no usable public comments.");
  });

  it("repairs once when the critic asks for a revision and then renders", async () => {
    state.queue = [plan, evidence, narrative, visualSystem, deck(), critique("revise"), deck(), critique("pass")].map(reply);
    const captured = captureEvents();

    const result = await runTeamAgent(request(), "repair-run");
    captured.stop();

    expect(state.requests).toHaveLength(8);
    expect(result.rounds).toBe(8);
    expect(result.artifact?.downloadUrl).toBe("/api/artifacts/deck.pptx");
    const repairRequest = state.requests[6];
    expect(repairRequest.instructions).toContain("Deck Composer returning");
    expect(JSON.parse(repairRequest.input[0].content).critique.verdict).toBe("revise");
    const calls = captured.events
      .filter((event) => (event.payload as any)?.type === "agent_call")
      .map((event) => event.payload as any);
    expect(new Set(calls.map((call) => call.agent)).size).toBe(6);
    expect(calls.find((call) => call.agent === "deck_composer" && call.stage === "repair")).toBeTruthy();
    expect(calls.find((call) => call.agent === "independent_critic" && call.stage === "recheck")).toBeTruthy();
  });

  it("blocks rendering but returns the deck and blockers when the critic still objects after the single repair", async () => {
    state.queue = [plan, evidence, narrative, visualSystem, deck(), critique("revise"), deck(), critique("revise")].map(reply);
    const captured = captureEvents();

    const result = await runTeamAgent(request(), "gate-run");
    captured.stop();

    expect(result.artifact).toBeNull();
    expect(result.deck).not.toBeNull();
    expect(result.gate?.passed).toBe(false);
    expect(result.gate?.blockers[0]).toContain("[critic]");
    expect(result.output).toContain("품질 게이트가 렌더를 차단했습니다");
    const failure = captured.events.find((event) => (event.payload as any)?.state === "team_gate_failed");
    expect(failure?.type).toBe("error");
    expect((failure?.payload as any).blockers[0]).toContain("[critic]");
  });

  it("binds art direction and aesthetic intent from contracts and strips all community citations from slides", async () => {
    const forged = deck() as any;
    forged.slides[1].citations = [{ url: "https://x.com/invented/status/999", title: "Invented", handle: "@invented", excerpt: "Not researched" }];
    forged.slides[1].visualDirective = { layout: "hero", composition: "Forged direction", visualAssetType: "none", imageNeed: "none", emphasis: "forged", avoid: [] };
    forged.aestheticIntent = { ...visualSystem.aestheticIntent, rationale: "A forged rationale the Art Director never wrote." };
    state.queue = [plan, evidence, narrative, visualSystem, forged, critique("pass")].map(reply);

    const result = await runTeamAgent(request(), "binding-run");

    // Community posts are an evaluation rubric only; no slide may cite them.
    expect(result.deck?.slides.every((slide) => slide.citations.length === 0)).toBe(true);
    const signal = result.deck?.slides[1];
    expect(signal?.visualDirective.layout).toBe("evidence_focus");
    expect(signal?.visualDirective.composition).toBe("인용 중심 구성");
    expect(result.deck?.aestheticIntent.rationale).toBe(visualSystem.aestheticIntent.rationale);
  });

  it("repairs an art director asset-layout contract violation instead of failing the run", async () => {
    const badVisualSystem = {
      ...visualSystem,
      slideDirectives: [
        visualSystem.slideDirectives[0]!,
        { ...visualSystem.slideDirectives[1]!, visualAssetType: "diagram" as const },
        visualSystem.slideDirectives[2]!,
      ],
    };
    state.queue = [plan, evidence, narrative, badVisualSystem, visualSystem, deck(), critique("pass")].map(reply);
    const captured = captureEvents();

    const result = await runTeamAgent(request(), "art-repair-run");
    captured.stop();

    expect(result.artifact).not.toBeNull();
    const artCalls = captured.events.filter((event) => (event.payload as any)?.type === "agent_call" && (event.payload as any)?.agent === "art_director");
    expect(artCalls.length).toBe(2);
  });

  it("blocks a deck that leaks community post content into its copy", async () => {
    const leaked = deck() as any;
    leaked.slides[1].bullets = ["@creator 계정도 The output all looks the same 이라고 말했다", "검수 부담"];
    state.queue = [plan, evidence, narrative, visualSystem, leaked, critique("pass"), leaked, critique("pass")].map(reply);

    const result = await runTeamAgent(request(), "leak-run");

    expect(result.artifact).toBeNull();
    expect(result.gate?.passed).toBe(false);
    expect(result.gate?.blockers.some((blocker) => blocker.includes("COMMUNITY_CONTENT_LEAK"))).toBe(true);
  });

  it("retries a role once with contract feedback and continues on a valid second reply", async () => {
    const invalidPlan = { ...plan, topicQuery: "" };
    state.queue = [invalidPlan, plan, evidence, narrative, visualSystem, deck(), critique("pass")].map(reply);
    const captured = captureEvents();

    const result = await runTeamAgent(request(), "retry-run");
    captured.stop();

    expect(result.artifact).not.toBeNull();
    expect(state.requests).toHaveLength(7);
    const retryRequest = state.requests[1];
    expect(retryRequest.input).toHaveLength(2);
    expect(retryRequest.input[1].content).toContain("research_plan");
    const violation = captured.events.find((event) => (event.payload as any)?.type === "agent_contract_violation");
    expect((violation?.payload as any)?.will_retry).toBe(true);
  });

  it("fails the run when a role still breaks its contract after the retry", async () => {
    const invalidPlan = { ...plan, topicQuery: "" };
    state.queue = [invalidPlan, invalidPlan].map(reply);

    await expect(runTeamAgent(request(), "retry-exhausted")).rejects.toThrow("research_plan contract after 2 attempts");
  });

  it("stops the role when the model reply was cut off by the token cap", async () => {
    state.queue = [{
      status: "incomplete",
      incomplete_details: { reason: "max_output_tokens" },
      usage: { input_tokens: 10, output_tokens: 800, total_tokens: 810 },
      output: [],
      output_text: "",
    }];

    await expect(runTeamAgent(request(), "truncated-run")).rejects.toThrow("max_output_tokens");
  });

  it("continues with the remaining lanes when one X search throws", async () => {
    const xai = await import("../src/providers/xai.js");
    vi.mocked(xai.researchX).mockRejectedValueOnce(new Error("xAI 503"));
    state.queue = [plan, evidence, narrative, visualSystem, deck(), critique("pass")].map(reply);
    const captured = captureEvents();

    const result = await runTeamAgent(request(), "lane-failure");
    captured.stop();

    expect(result.artifact).not.toBeNull();
    const failure = captured.events.find((event) => (event.payload as any)?.type === "x_search_failed");
    expect((failure?.payload as any).message).toContain("xAI 503");
    const analystInput = JSON.parse(state.requests[1].input[0].content);
    expect(analystInput.warnings.join(" ")).toContain("xAI 503");
  });
});
