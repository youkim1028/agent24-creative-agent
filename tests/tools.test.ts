import { describe, expect, it } from "vitest";
import { executeTool } from "../src/agent/tools.js";

describe("agent tools", () => {
  it("normalizes a brief into an inspectable result", async () => {
    const result = JSON.parse(
      await executeTool(
        "analyze_brief",
        JSON.stringify({
          objective: "Create a campus audio guide",
          audience: "First-year students",
          deliverable: "45-second script",
          constraints: ["Korean", "Mention the library"],
        }),
      ),
    );

    expect(result.ok).toBe(true);
    expect(result.constraint_count).toBe(2);
    expect(result.normalized_brief.deliverable).toBe("45-second script");
  });

  it("flags criteria with weak keyword coverage", async () => {
    const result = JSON.parse(
      await executeTool(
        "review_draft",
        JSON.stringify({
          draft: "도서관으로 함께 이동합니다.",
          criteria: ["도서관 포함", "학생식당과 도움 요청 방법 포함"],
        }),
      ),
    );

    expect(result.ok).toBe(true);
    expect(result.verdict).toBe("revise");
    expect(result.material_gaps).toContain("학생식당과 도움 요청 방법 포함");
  });

  it("returns a structured failure for invalid arguments", async () => {
    const result = JSON.parse(await executeTool("review_draft", "{}"));
    expect(result.ok).toBe(false);
    expect(result.error).toBeTypeOf("string");
  });
});

