import { describe, expect, it } from "vitest";
import { unlink } from "node:fs/promises";
import path from "node:path";
import { availableToolDefinitions, executeTool, toolDefinitions } from "../src/agent/tools.js";
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
      { id: "title", archetype: "title", visualRole: "declaration", eyebrow: "LIVE SIGNAL", title: "X 신호를 의사결정으로", takeaway: "", bullets: [], stats: [], notes: "오프닝", citations: [] },
      { id: "signal", archetype: "claim", visualRole: "evidence", eyebrow: "SIGNAL", title: "관심보다 검증 요구가 먼저 보인다", takeaway: "사용자는 새로움보다 반복 가능한 효용을 묻는다.", bullets: ["긍정은 속도", "우려는 신뢰성"], stats: [], notes: "반응과 사실을 구분", citations: [citation] },
      { id: "close", archetype: "closing", visualRole: "synthesis", eyebrow: "ACTION", title: "반응을 검증할 질문으로 바꿔라", takeaway: "Grok은 신호를 찾고 GPT는 논지를 설계한다.", bullets: [], stats: [], notes: "마무리", citations: [citation] },
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

  it("accepts Reddit as a community-conversation source", () => {
    const deck = validDeck();
    deck.slides[1]!.citations = [{
      url: "https://www.reddit.com/r/powerpoint/comments/abc/example/",
      title: "Example Reddit complaint",
      handle: "deck_user",
      excerpt: "AI slides repeat the same layout.",
    }];
    expect(validateDeck(deck).issues.map((issue) => issue.code)).not.toContain("NON_COMMUNITY_SOURCE");
  });

  it("blocks an ungrounded numeric claim", () => {
    const deck = validDeck();
    deck.slides[1]!.takeaway = "사용자의 72%가 기능을 원한다.";
    deck.slides[1]!.citations = [];
    const result = validateDeck(deck);
    expect(fatalIssues(result.issues).map((issue) => issue.code)).toContain("UNGROUNDED_FIGURE");
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

  it("returns a clearly labelled mock X result without a key", async () => {
    const execution = await executeTool(
      "research_x",
      JSON.stringify({
        query: "AI 영상 도구 반응",
        markets: [{ country: "South Korea", search_language: "ko" }],
        from_date: null,
        to_date: null,
        allowed_x_handles: [],
      }),
      { runId: "test" },
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
      query: "AI video editor complaints",
      markets: [{ country: "United States", searchLanguage: "en" }],
      maxPosts: 6,
      fromDate: null,
      toDate: null,
      allowedHandles: [],
    }, 6);
    expect(prompt).toContain("retrieval worker, not an analyst");
    expect(prompt).toContain("at most 6 posts total");
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

  it("evaluates visual roles and aesthetic intent", async () => {
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

  it("renders the exact validated and evaluated deck with the runtime module loader", async () => {
    const context = { runId: "render-integration" };
    await executeTool("validate_deck", JSON.stringify({ deck: validDeck() }), context);
    await executeTool("evaluate_deck", JSON.stringify({}), context);
    const execution = await executeTool("render_deck", JSON.stringify({}), context);
    const result = JSON.parse(execution.output);

    expect(result.ok).toBe(true);
    expect(result.artifact.filename).toMatch(/\.pptx$/);
    expect(result.artifact.jsonFilename).toMatch(/\.json$/);

    await Promise.all([
      unlink(path.resolve("artifacts", result.artifact.filename)),
      unlink(path.resolve("artifacts", result.artifact.jsonFilename)),
    ]);
  });
});
