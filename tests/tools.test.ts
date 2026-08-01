import { describe, expect, it } from "vitest";
import { unlink } from "node:fs/promises";
import path from "node:path";
import { availableToolDefinitions, executeTool, toolDefinitions } from "../src/agent/tools.js";
import { evaluateDeck } from "../src/deck/evaluate.js";
import type { DeckSpec } from "../src/deck/schema.js";
import { fatalIssues, validateDeck } from "../src/deck/validate.js";
import { buildXExtractionPrompt } from "../src/providers/xai-prompt.js";
import { resolveResearchMarkets } from "../src/research/markets.js";

const citation = {
  url: "https://x.com/xai/status/123",
  title: "Example X post",
  handle: "@xai",
  excerpt: "Example evidence",
};

const heroDirective = { layout: "hero" as const, layoutFamily: "opening_hero" as const, dominantVisual: "headline" as const, informationShape: "declaration" as const, composition: "Left-aligned declaration", visualAssetType: "none" as const, imageNeed: "none" as const, emphasis: "title", avoid: ["decoration"] };
const evidenceDirective = { layout: "evidence_focus" as const, layoutFamily: "evidence_list" as const, dominantVisual: "evidence" as const, informationShape: "evidence" as const, composition: "Source-led evidence", visualAssetType: "none" as const, imageNeed: "none" as const, emphasis: "evidence", avoid: ["fake quotes"] };
const closingDirective = { layout: "statement" as const, layoutFamily: "closing_statement" as const, dominantVisual: "headline" as const, informationShape: "synthesis" as const, composition: "Single closing action", visualAssetType: "none" as const, imageNeed: "none" as const, emphasis: "action", avoid: ["summary list"] };

function validDeck(): DeckSpec {
  return {
    title: "X 신호를 의사결정으로",
    subtitle: "실시간 반응을 검증 가능한 논지로 바꾸는 방법",
    audience: "서비스 기획팀",
    thesis: "반응은 답이 아니라 검증할 질문을 보여준다.",
    language: "ko",
    aestheticIntent: {
      theme: "ink_acid",
      rationale: "Evidence-heavy decision deck needs high contrast and restraint.",
      mood: "focused",
      layoutLogic: "One claim per slide with clear evidence blocks.",
      imageLogic: "Use only images that clarify a claim.",
      avoid: ["decorative AI imagery"],
    },
    slides: [
      { id: "title", archetype: "title", visualRole: "declaration", visualDirective: heroDirective, eyebrow: "LIVE SIGNAL", title: "X 신호를 의사결정으로", takeaway: "", bullets: [], stats: [], notes: "오프닝", citations: [] },
      { id: "signal", archetype: "claim", visualRole: "evidence", visualDirective: evidenceDirective, eyebrow: "SIGNAL", title: "관심보다 검증 요구가 먼저 보인다", takeaway: "사용자는 새로움보다 반복 가능한 효용을 묻는다.", bullets: ["긍정은 속도", "우려는 신뢰성"], stats: [], notes: "반응과 사실을 구분", citations: [citation] },
      { id: "close", archetype: "closing", visualRole: "synthesis", visualDirective: closingDirective, eyebrow: "ACTION", title: "반응을 검증할 질문으로 바꿔라", takeaway: "Grok은 신호를 찾고 GPT는 논지를 설계한다.", bullets: [], stats: [], notes: "마무리", citations: [citation] },
    ],
  };
}

describe("DeckForge X tools", () => {
  it("exposes one precise tool per pipeline decision", () => {
    expect(toolDefinitions.map((tool) => tool.name)).toEqual([
      "research_x",
      "review_outline",
      "validate_deck",
      "evaluate_deck",
      "render_deck",
    ]);
  });

  it("exposes only the tool needed for the current stage", () => {
    expect(availableToolDefinitions({ runId: "test" }).map((tool) => tool.name)).toEqual(["research_x"]);
    expect(availableToolDefinitions({ runId: "test", researchCompleted: true }).map((tool) => tool.name)).toEqual(["review_outline"]);
    expect(availableToolDefinitions({ runId: "test", researchCompleted: true, outlineReviewed: true }).map((tool) => tool.name)).toEqual(["validate_deck"]);
  });

  it("accepts a grounded, ordered deck", () => {
    const result = validateDeck(validDeck());
    expect(result.deck).not.toBeNull();
    expect(fatalIssues(result.issues)).toEqual([]);
  });

  it("accepts YouTube comments as a community-conversation source", () => {
    const deck = validDeck();
    deck.slides[1]!.citations = [{
      url: "https://www.youtube.com/watch?v=example&lc=comment-1",
      title: "Example YouTube comment",
      handle: "deck_user",
      excerpt: "AI slides repeat the same layout.",
    }];
    expect(validateDeck(deck).issues.map((issue) => issue.code)).not.toContain("NON_COMMUNITY_SOURCE");
  });

  it("accepts Hacker News discussions as a community-conversation source", () => {
    const deck = validDeck();
    deck.slides[1]!.citations = [{
      url: "https://news.ycombinator.com/item?id=123456",
      title: "Example Hacker News discussion",
      handle: "builder",
      excerpt: "Generated decks need clearer provenance.",
    }];
    expect(fatalIssues(validateDeck(deck).issues)).toEqual([]);
  });

  it("flags Korean sentence-form titles as an AI tell", () => {
    const deck = validDeck();
    deck.slides[1]!.title = "게이트가 출력을 결정한다";
    const issues = validateDeck(deck).issues;
    expect(issues.map((issue) => issue.code)).toContain("KO_SENTENCE_TITLE");
    // 명사구 제목은 통과한다.
    const fixed = validDeck();
    fixed.slides[1]!.title = "실패 폐쇄형 게이트";
    expect(validateDeck(fixed).issues.map((issue) => issue.code)).not.toContain("KO_SENTENCE_TITLE");
  });

  it("no longer demands community citations for numeric claims — that judgment belongs to the critic", () => {
    const deck = validDeck();
    deck.slides[1]!.takeaway = "사용자의 72%가 기능을 원한다.";
    deck.slides[1]!.citations = [];
    const result = validateDeck(deck);
    expect(fatalIssues(result.issues)).toEqual([]);
  });

  it("blocks visual directives whose required content cannot be rendered", () => {
    const deck = validDeck();
    deck.slides[1]!.visualDirective = { ...evidenceDirective, layout: "steps" };
    deck.slides[1]!.bullets = [];
    expect(fatalIssues(validateDeck(deck).issues).map((issue) => issue.code)).toContain("LAYOUT_INPUT_MISSING");
  });

  it("rejects a table-of-contents outline", async () => {
    const execution = await executeTool(
      "review_outline",
      JSON.stringify({
        thesis: "논지",
        audience: "심사위원",
        beats: [{ position: 1, claim: "배경", evidence_needed: "X 검색" }],
      }),
      { runId: "test" },
    );
    const result = JSON.parse(execution.output);
    expect(result.ok).toBe(false);
    expect(result.issues[0]).toContain("not a claim");
  });

  // forceMockX keeps this on the keyless branch even when a real XAI_API_KEY is present,
  // so the assertion never depends on the developer's local .env.
  it("labels a mock X result as a rehearsal instead of evidence", async () => {
    const execution = await executeTool(
      "research_x",
      JSON.stringify({
        lane: "topic",
        query: "AI 영상 도구 반응",
        markets: [{ country: "South Korea", search_language: "ko" }],
        from_date: null,
        to_date: null,
        allowed_x_handles: [],
      }),
      { runId: "test", forceMockX: true },
    );
    const result = JSON.parse(execution.output);
    expect(result.mode).toBe("mock");
    expect(result.warning).toContain("XAI_API_KEY");
    expect(result.cache).toBe("disabled");
  });

  it("uses different default complaint markets by output language", () => {
    expect(resolveResearchMarkets("ko", []).map((market) => market.country)).toEqual(["South Korea", "United States"]);
    expect(resolveResearchMarkets("en", []).map((market) => market.country)).toEqual(["United States", "United Kingdom"]);
  });

  it("keeps Grok in bounded post-extraction mode", () => {
    const prompt = buildXExtractionPrompt({
      lane: "topic",
      query: "AI video editor complaints",
      markets: [{ country: "United States", searchLanguage: "en" }],
      maxPosts: 6,
      fromDate: null,
      toDate: null,
      allowedHandles: [],
    }, 6);
    expect(prompt).toContain("retrieval worker, not an analyst");
    expect(prompt).toContain("Retrieve up to 6 candidate posts total");
    expect(prompt).toContain("Prioritize recent posts first");
    expect(prompt).toContain("Do not summarize");
  });

  it("blocks render when the exact deck was not validated in the same run", async () => {
    const execution = await executeTool(
      "render_deck",
      JSON.stringify({}),
      { runId: "test" },
    );
    const result = JSON.parse(execution.output);
    expect(result.ok).toBe(false);
    expect(result.error).toBe("UNVALIDATED_DECK");
  });

  it("evaluates rendered layouts and aesthetic intent", async () => {
    const context = { runId: "test" };
    await executeTool("validate_deck", JSON.stringify({ deck: validDeck() }), context);
    const execution = await executeTool(
      "evaluate_deck",
      JSON.stringify({}),
      context,
    );
    const result = JSON.parse(execution.output);
    expect(result.score).toBeGreaterThanOrEqual(70);
    expect(result.dimensions.visualIntent).toBe(100);
  });

  it("accepts a citation-free deck — community research is an evaluation rubric, not deck content", () => {
    const deck = validDeck();
    for (const slide of deck.slides) slide.citations = [];
    const evaluation = evaluateDeck(deck);

    expect(evaluation.issues.some((issue) => issue.severity === "error")).toBe(false);
    expect(evaluation.ready).toBe(true);
  });

  it("renders the exact validated and evaluated deck with the runtime module loader", async () => {
    const context = { runId: "render-integration" };
    await executeTool("validate_deck", JSON.stringify({ deck: validDeck() }), context);
    await executeTool("evaluate_deck", JSON.stringify({}), context);
    const execution = await executeTool("render_deck", JSON.stringify({}), context);
    const result = JSON.parse(execution.output);

    expect(result.ok).toBe(true);
    expect(result.artifact.filename).toMatch(/\.pptx$/);
    expect(result.artifact.filename.normalize("NFC")).toBe(result.artifact.filename);
    expect(result.artifact.jsonFilename).toMatch(/\.json$/);

    await Promise.all([
      unlink(path.resolve("artifacts", result.artifact.filename)),
      unlink(path.resolve("artifacts", result.artifact.jsonFilename)),
    ]);
  });
});
