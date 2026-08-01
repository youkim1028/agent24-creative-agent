import { describe, expect, it } from "vitest";
import { parseRedditSearch, rankRedditPosts } from "../src/providers/reddit.js";
import { critiqueReportSchema, researchPlanSchema } from "../src/team/contracts.js";
import { ART_DIRECTOR_PROMPT, INDEPENDENT_CRITIC_PROMPT } from "../src/team/prompts.js";
import { modelForTeamAgent } from "../src/team/team-runner.js";

describe("team architecture contracts", () => {
  it("keeps research planning bounded to explicit markets", () => {
    const plan = researchPlanSchema.parse({
      topicQuery: "AI slide generator complaints Korea",
      designCritiqueQuery: "generic AI presentation design criticism",
      markets: [{ country: "South Korea", searchLanguage: "ko" }],
      subredditHints: ["powerpoint", "presentations"],
      rationale: "Separate subject friction from design criticism.",
    });
    expect(plan.markets).toHaveLength(1);
    expect(plan.subredditHints.length).toBeLessThanOrEqual(5);
  });

  it("requires an independent critic verdict and bounded scores", () => {
    expect(() => critiqueReportSchema.parse({
      verdict: "pass",
      scores: { grounding: 101, narrative: 90, topicAestheticFit: 90, userVoice: 90, antiCliche: 90 },
      issues: [],
      summary: "Looks good",
    })).toThrow();
    expect(INDEPENDENT_CRITIC_PROMPT).toContain("did not create the deck");
    expect(ART_DIRECTOR_PROMPT).toContain("community design criticism");
  });

  it("normalizes bounded Reddit search results without model inference", () => {
    const posts = parseRedditSearch({
      data: {
        children: [
          { data: {
            permalink: "/r/powerpoint/comments/abc/generic_ai_slides/",
            title: "AI slides all look the same",
            selftext: "The layouts repeat and the icons add no meaning.",
            author: "deck_user",
            subreddit: "powerpoint",
            created_utc: 1_700_000_000,
            score: 42,
            num_comments: 11,
            over_18: false,
          } },
        ],
      },
    }, {
      lane: "design_critique",
      query: "AI presentation design complaints",
      markets: [{ country: "United States", searchLanguage: "en" }],
    }, 3);

    expect(posts).toHaveLength(1);
    expect(posts[0]?.platform).toBe("reddit");
    expect(posts[0]?.community).toBe("r/powerpoint");
    expect(posts[0]?.engagement).toEqual({ score: 42, comments: 11 });
  });

  it("ranks Reddit candidates by recency and engagement before handoff", () => {
    const posts = parseRedditSearch({
      data: { children: [
        { data: { permalink: "/r/powerpoint/comments/old/old/", title: "Old popular post", author: "old", subreddit: "powerpoint", created_utc: 1_700_000_000, score: 5000, num_comments: 200 } },
        { data: { permalink: "/r/powerpoint/comments/new/new/", title: "Recent useful post", author: "recent", subreddit: "powerpoint", created_utc: 1_780_000_000, score: 1000, num_comments: 20 } },
      ] },
    }, {
      lane: "design_critique",
      query: "AI presentation design complaints",
      markets: [{ country: "United States", searchLanguage: "en" }],
    }, 2);
    const ranked = rankRedditPosts(posts, 1, Date.parse("2026-08-01T00:00:00Z"));
    expect(ranked[0]?.author).toBe("recent");
  });

  it("routes team roles to fast, quality, and critic model tiers", () => {
    expect(modelForTeamAgent("research_planner")).toBe("gpt-5.6-luna");
    expect(modelForTeamAgent("deck_composer")).toBe("gpt-5.6-terra");
    expect(modelForTeamAgent("independent_critic")).toBe("gpt-5.6-luna");
  });
});
