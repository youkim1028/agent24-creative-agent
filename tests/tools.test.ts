import { describe, expect, it } from "vitest";
import { executeTool, toolDefinitions } from "../src/agent/tools.js";
import type { DeckSpec } from "../src/deck/schema.js";
import { fatalIssues, validateDeck } from "../src/deck/validate.js";

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
    slides: [
      { id: "title", archetype: "title", eyebrow: "LIVE SIGNAL", title: "X 신호를 의사결정으로", takeaway: "", bullets: [], stats: [], notes: "오프닝", citations: [] },
      { id: "signal", archetype: "claim", eyebrow: "SIGNAL", title: "관심보다 검증 요구가 먼저 보인다", takeaway: "사용자는 새로움보다 반복 가능한 효용을 묻는다.", bullets: ["긍정은 속도", "우려는 신뢰성"], stats: [], notes: "반응과 사실을 구분", citations: [citation] },
      { id: "close", archetype: "closing", eyebrow: "ACTION", title: "반응을 검증할 질문으로 바꿔라", takeaway: "Grok은 신호를 찾고 GPT는 논지를 설계한다.", bullets: [], stats: [], notes: "마무리", citations: [citation] },
    ],
  };
}

describe("DeckForge X tools", () => {
  it("exposes one precise tool per pipeline decision", () => {
    expect(toolDefinitions.map((tool) => tool.name)).toEqual([
      "research_x",
      "review_outline",
      "validate_deck",
      "render_deck",
    ]);
  });

  it("accepts a grounded, ordered deck", () => {
    const result = validateDeck(validDeck());
    expect(result.deck).not.toBeNull();
    expect(fatalIssues(result.issues)).toEqual([]);
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
      JSON.stringify({ query: "AI 영상 도구 반응", from_date: null, to_date: null, allowed_x_handles: [] }),
      { runId: "test" },
    );
    const result = JSON.parse(execution.output);
    expect(result.mode).toBe("mock");
    expect(result.warning).toContain("XAI_API_KEY");
  });

  it("blocks render when the exact deck was not validated in the same run", async () => {
    const execution = await executeTool(
      "render_deck",
      JSON.stringify({ deck: validDeck() }),
      { runId: "test" },
    );
    const result = JSON.parse(execution.output);
    expect(result.ok).toBe(false);
    expect(result.error).toBe("UNVALIDATED_DECK");
  });
});
