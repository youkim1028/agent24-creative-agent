import { describe, expect, it } from "vitest";
import { parseYouTubeComments, parseYouTubeVideos, rankYouTubeComments } from "../src/providers/youtube.js";
import { YouTubeQuotaLedger } from "../src/providers/youtube-quota.js";
import { parseHackerNewsSearch, rankHackerNewsPosts } from "../src/providers/hacker-news.js";
import { researchX } from "../src/providers/xai.js";
import { critiqueReportSchema, researchPlanSchema } from "../src/team/contracts.js";
import { ART_DIRECTOR_PROMPT, INDEPENDENT_CRITIC_PROMPT } from "../src/team/prompts.js";
import { applyPresentationOverrides, executionForTeamAgent, modelForTeamAgent, splitResearchLimit, TEAM_AGENT_ROLES, visualSystemConnectionIssues } from "../src/team/team-runner.js";
import { config } from "../src/config.js";
import { researchMemoryObjectName } from "../src/memory/gcs-research.js";
import { traceEvents } from "../src/events/event-bus.js";

describe("team architecture contracts", () => {
  it("partitions GCS research memory by provider and lane without exposing the query in the object name", () => {
    const shared = {
      query: "private launch feedback",
      markets: [{ country: "South Korea", searchLanguage: "ko" }],
      maxPosts: 3,
      fromDate: "2026-07-01",
      toDate: "2026-08-01",
    };
    const xName = researchMemoryObjectName("x", { ...shared, lane: "topic", allowedHandles: [] });
    const youtubeName = researchMemoryObjectName("youtube", {
      ...shared,
      lane: "design_critique",
      videoCandidates: 3,
      commentsPerVideo: 20,
      relevanceLanguage: "ko",
    });
    const hackerNewsName = researchMemoryObjectName("hacker_news", {
      ...shared,
      lane: "topic",
      searchCandidates: 12,
    });

    expect(xName).toContain("/v5/x/topic/");
    expect(youtubeName).toContain("/v5/youtube/design_critique/");
    expect(hackerNewsName).toContain("/v5/hacker_news/topic/");
    expect(xName).not.toContain("private launch feedback");
    expect(xName).not.toBe(youtubeName);

    // The stable brief seed, not the LLM-generated query wording, decides the key:
    // repeat runs of one brief reuse the cache even when the planner rewords queries.
    const seededA = researchMemoryObjectName("x", { ...shared, lane: "topic", allowedHandles: [], cacheSeed: "brief text" });
    const seededB = researchMemoryObjectName("x", { ...shared, query: "completely different planner wording", lane: "topic", allowedHandles: [], cacheSeed: "brief text" });
    const seededC = researchMemoryObjectName("x", { ...shared, lane: "topic", allowedHandles: [], cacheSeed: "another brief" });
    expect(seededA).toBe(seededB);
    expect(seededA).not.toBe(seededC);
    expect(seededA).not.toContain("brief text");

    const reordered = researchMemoryObjectName("x", {
      ...shared,
      lane: "topic",
      markets: [
        { country: "United States", searchLanguage: "en" },
        { country: "South Korea", searchLanguage: "ko" },
      ],
      allowedHandles: ["@Beta", "@alpha", "@alpha"],
    });
    const canonical = researchMemoryObjectName("x", {
      ...shared,
      lane: "topic",
      markets: [
        { country: "South Korea", searchLanguage: "ko" },
        { country: "United States", searchLanguage: "en" },
      ],
      allowedHandles: ["alpha", "beta"],
    });
    expect(reordered).toBe(canonical);
  });

  it("keeps research planning bounded to explicit markets", () => {
    const plan = researchPlanSchema.parse({
      presentationProfile: {
        purpose: "Prioritize product improvements",
        audience: "Product leads",
        presentationContext: "Weekly product review",
        userVoice: "Direct and evidence-led",
        visualPreference: "Restrained editorial layout",
        assumptions: ["The brief implies an internal decision meeting."],
      },
      topicQuery: "AI slide generator complaints Korea",
      designCritiqueQuery: "generic AI presentation design criticism",
      topicKeywordQuery: "AI slide generator problems",
      designCritiqueKeywordQuery: "AI presentation design criticism",
      markets: [{ country: "South Korea", searchLanguage: "ko" }],
      rationale: "Separate subject friction from design criticism.",
    });
    expect(plan.markets).toHaveLength(1);
    expect(plan.topicQuery).toContain("complaints");
  });

  it("lets the planner infer presentation context while preserving explicit user constraints", () => {
    const inferred = {
      purpose: "Explain the community signal",
      audience: "General decision-makers",
      presentationContext: "Short live review",
      userVoice: "Clear and analytical",
      visualPreference: "Restrained editorial design",
      assumptions: ["The audience was inferred from the decision-oriented brief."],
    };
    const resolved = applyPresentationOverrides(inferred, {
      purpose: "",
      audience: "대학생 심사위원",
      presentationContext: "",
      userVoice: "차분하고 솔직하게",
      visualPreference: "",
    });

    expect(resolved.purpose).toBe(inferred.purpose);
    expect(resolved.audience).toBe("대학생 심사위원");
    expect(resolved.userVoice).toBe("차분하고 솔직하게");
    expect(resolved.visualPreference).toBe(inferred.visualPreference);
  });

  it("requires an independent critic verdict and bounded scores", () => {
    expect(() => critiqueReportSchema.parse({
      verdict: "pass",
      scores: { grounding: 101, narrative: 90, topicAestheticFit: 90, userVoice: 90, antiCliche: 90 },
      issues: [],
      summary: "Looks good",
    })).toThrow();
    expect(INDEPENDENT_CRITIC_PROMPT).toContain("did not create the deck");
    expect(ART_DIRECTOR_PROMPT).toContain("CommunityEvidence rubric");
  });

  it("normalizes bounded YouTube comments without inferring an author country", () => {
    const [video] = parseYouTubeVideos({ items: [{
      id: { videoId: "video-1" },
      snippet: { title: "AI slides &amp; sameness", channelTitle: "Deck Lab", publishedAt: "2026-07-10T00:00:00Z" },
    }] }, 3, "South Korea", "KR");
    const posts = parseYouTubeComments({ items: [{ snippet: {
      topLevelComment: { id: "comment-1", snippet: {
        textOriginal: "The layouts repeat and the icons add no meaning.",
        authorDisplayName: "viewer",
        publishedAt: "2026-07-20T12:00:00Z",
        likeCount: 42,
      } },
      totalReplyCount: 11,
    } }] }, { lane: "design_critique", fromDate: "2026-07-01", toDate: "2026-07-31" }, video!);

    expect(posts).toHaveLength(1);
    expect(posts[0]?.platform).toBe("youtube");
    expect(posts[0]?.url).toContain("youtube.com/watch?v=video-1&lc=comment-1");
    expect(posts[0]?.country).toBe("");
    expect(posts[0]?.discoveryMarket).toBe("South Korea");
    expect(posts[0]?.engagement).toEqual({ likes: 42, reposts: null, score: null, comments: 11 });
  });

  it("applies the requested date window to YouTube comments", () => {
    const video = { id: "video-1", title: "Deck review", channelTitle: "Deck Lab", publishedAt: null };
    const posts = parseYouTubeComments({ items: [
      { snippet: { topLevelComment: { id: "inside", snippet: { textOriginal: "Inside range", authorDisplayName: "inside", publishedAt: "2026-07-20T12:00:00Z", likeCount: 2 } }, totalReplyCount: 1 } },
      { snippet: { topLevelComment: { id: "outside", snippet: { textOriginal: "Outside range", authorDisplayName: "outside", publishedAt: "2026-06-20T12:00:00Z", likeCount: 100 } }, totalReplyCount: 30 } },
    ] }, { lane: "topic", fromDate: "2026-07-01", toDate: "2026-07-31" }, video);

    expect(posts.map((post) => post.author)).toEqual(["inside"]);
  });

  it("parses Grok's structured citation JSON and rejects skeleton entries", async () => {
    const { parseXCitationJson } = await import("../src/providers/xai.js");
    const output = [
      "```json",
      JSON.stringify([
        { country: "South Korea", language: "ko", handle: "@zudnacis", url: "https://x.com/zudnacis/status/2072148960454832524", postedAt: "2026-07-01", excerpt: "AI PPT 레이아웃이 너무 획일화되고 있다", likes: 120, reposts: 4 },
        { country: "", language: "en", handle: "", url: "https://x.com/i/status/999", postedAt: null, excerpt: "shortcut url must be rejected", likes: null, reposts: null },
        { country: "", language: "en", handle: "@empty", url: "https://x.com/empty/status/123", postedAt: null, excerpt: "", likes: null, reposts: null },
      ]),
      "```",
    ].join("\n");

    const citations = parseXCitationJson(output, 5);
    expect(citations).toHaveLength(1);
    expect(citations[0]?.handle).toBe("@zudnacis");
    expect(citations[0]?.excerpt).toContain("획일화");
    expect(citations[0]?.postedAt).toBe("2026-07-01T00:00:00.000Z");
    expect(citations[0]?.engagement?.likes).toBe(120);
    expect(parseXCitationJson("no json here", 5)).toEqual([]);
  });

  it("shows a normalized X result in the trace even when no provider call is made", async () => {
    traceEvents.clear();
    const events: unknown[] = [];
    const stop = traceEvents.subscribe((event) => events.push(event));
    await researchX({
      lane: "topic",
      query: "mock retrieval",
      markets: [{ country: "South Korea", searchLanguage: "ko" }],
      maxPosts: 2,
      fromDate: null,
      toDate: null,
      allowedHandles: [],
    }, "x-trace-test", true);
    stop();

    expect(events.some((event) => (event as { payload?: { type?: string } }).payload?.type === "x_research")).toBe(true);
    expect(events.some((event) => (event as { payload?: { type?: string } }).payload?.type === "x_research_result")).toBe(true);
  });

  it("ranks YouTube comments by engagement and recency while diversifying videos", () => {
    const makePost = (author: string, video: string, likes: number, postedAt: string) => ({
      lane: "topic" as const, platform: "youtube" as const,
      url: `https://www.youtube.com/watch?v=${video}&lc=${author}`,
      title: "Deck review", author, community: "YouTube · Deck Lab", excerpt: `${author} useful feedback`,
      country: "", language: "en", postedAt,
      engagement: { likes, reposts: null, score: null, comments: 0 },
    });
    const ranked = rankYouTubeComments([
      makePost("top-a", "video-a", 1000, "2026-07-30T00:00:00Z"),
      makePost("second-a", "video-a", 900, "2026-07-29T00:00:00Z"),
      makePost("top-b", "video-b", 100, "2026-07-28T00:00:00Z"),
    ], 2, Date.parse("2026-08-01T00:00:00Z"));
    expect(ranked.map((post) => post.author)).toEqual(["top-a", "top-b"]);
  });

  it("filters keyword-search results that share no domain tokens with the query", async () => {
    const { isQueryRelevant } = await import("../src/research/community-signal.js");
    const query = "AI generated presentation design problems";
    expect(isQueryRelevant(
      "The AI tool discovery problem — I've spent months researching and categorizing hundreds of AI tools. Building AI products is getting easier, discovery is getting harder.",
      query,
      2,
    )).toBe(false);
    expect(isQueryRelevant(
      "Every AI generated presentation uses the same design and layout",
      query,
      2,
    )).toBe(true);
  });

  it("drops praise comments and ranks critique above popularity", () => {
    const makePost = (author: string, excerpt: string, likes: number) => ({
      lane: "topic" as const, platform: "youtube" as const,
      url: `https://www.youtube.com/watch?v=video-${author}&lc=${author}`,
      title: "AI presentation review", author, community: "YouTube · Deck Lab", excerpt,
      country: "", language: "en", postedAt: "2026-07-30T00:00:00Z",
      engagement: { likes, reposts: null, score: null, comments: 0 },
    });
    const ranked = rankYouTubeComments([
      makePost("praise", "Huge THANK YOU for such awesome and helpful content, love it!", 500),
      makePost("critic", "The layouts are repetitive and generic, and the text is unreadable half the time.", 3),
      makePost("neutral", "It's called kimi ai", 60),
    ], 3, Date.parse("2026-08-01T00:00:00Z"));

    expect(ranked.map((post) => post.author)).toEqual(["critic", "neutral"]);
  });

  it("stops YouTube calls at 80 percent and blocks 429 without retry", () => {
    let now = Date.parse("2026-08-01T00:00:00Z");
    const ledger = new YouTubeQuotaLedger(() => now);
    for (let index = 0; index < 8; index += 1) ledger.recordAttempt();
    expect(ledger.canCall(10, 0.8)).toEqual({ allowed: false, reason: "local_daily_80_percent_stop" });
    ledger.clear();
    ledger.recordAttempt();
    ledger.recordResponse(429, null, new Headers());
    expect(ledger.canCall(10, 0.8)).toEqual({ allowed: false, reason: "http_429_no_retry" });
    now += 7 * 60 * 60 * 1000;
    expect(ledger.snapshot().blockedUntil).not.toBeNull();
  });

  it("normalizes and ranks Hacker News discussions with direct item URLs", () => {
    const input = {
      lane: "topic" as const,
      query: "AI presentation complaints",
      markets: [{ country: "United States", searchLanguage: "en" }],
      maxPosts: 2,
      fromDate: "2026-07-01",
      toDate: "2026-08-01",
    };
    const posts = parseHackerNewsSearch({ hits: [
      { objectID: "100", story_title: "AI decks", comment_text: "The generated slides all look interchangeable.", author: "builder", created_at: "2026-07-30T00:00:00Z", points: 25 },
      { objectID: "200", title: "Older deck discussion", story_text: "Presentation tooling feedback", author: "founder", created_at: "2026-07-05T00:00:00Z", points: 3, num_comments: 2 },
    ] }, input, 12);
    expect(posts).toHaveLength(2);
    expect(posts[0]?.platform).toBe("hacker_news");
    expect(posts[0]?.url).toBe("https://news.ycombinator.com/item?id=100");
    expect(posts[0]?.country).toBe("");
    expect(rankHackerNewsPosts(posts, 1, Date.parse("2026-08-01T00:00:00Z"))[0]?.author).toBe("builder");
  });

  it("routes team roles to fast and critical model tiers", () => {
    expect(TEAM_AGENT_ROLES).toHaveLength(6);
    expect(new Set(TEAM_AGENT_ROLES).size).toBe(6);
    expect(modelForTeamAgent("research_planner")).toBe(config.fastModel);
    expect(modelForTeamAgent("evidence_analyst")).toBe(config.fastModel);
    expect(modelForTeamAgent("deck_composer")).toBe(config.criticalModel);
    // The critic follows OPENAI_CRITIC_MODEL, which defaults to the critical tier.
    expect(modelForTeamAgent("independent_critic")).toBe(config.criticModel);
    expect(executionForTeamAgent("independent_critic").model).toBe(config.criticModel);
    // Deep reasoning is reserved for the narrative architect; the other critical
    // roles run at the cheaper standard effort.
    expect(executionForTeamAgent("narrative_architect")).toEqual({
      model: config.criticalModel,
      reasoningEffort: config.criticalReasoningEffort,
      serviceTier: config.criticalServiceTier,
    });
    expect(executionForTeamAgent("deck_composer")).toEqual({
      model: config.criticalModel,
      reasoningEffort: config.standardReasoningEffort,
      serviceTier: config.criticalServiceTier,
    });
    expect(executionForTeamAgent("independent_critic").reasoningEffort).toBe(config.standardReasoningEffort);
    expect(executionForTeamAgent("research_planner").reasoningEffort).toBe(config.reasoningEffort);
  });

  it("splits every configured research cap exactly across the two lanes", () => {
    for (const total of [2, 3, 5, 6, 7, 8]) {
      const limits = splitResearchLimit(total);
      expect(limits.topic + limits.designCritique).toBe(total);
      expect(limits.topic).toBeGreaterThanOrEqual(limits.designCritique);
      expect(limits.designCritique).toBeGreaterThanOrEqual(1);
    }
  });

  it("rejects Art Director handoffs that do not map every narrative slide", () => {
    const narrative = {
      title: "Deck", subtitle: "", audience: "Team", thesis: "Decision", language: "en" as const,
      slides: [
        { id: "title", visualRole: "declaration" as const, claim: "Open", purpose: "Open", evidenceUrls: [], visiblePoints: [], presenterNote: "" },
        { id: "signal", visualRole: "evidence" as const, claim: "Signal", purpose: "Evidence", evidenceUrls: [], visiblePoints: [], presenterNote: "" },
        { id: "close", visualRole: "action" as const, claim: "Act", purpose: "Close", evidenceUrls: [], visiblePoints: [], presenterNote: "" },
      ],
    };
    const visualSystem = {
      aestheticIntent: {
        theme: "mono_evidence" as const, rationale: "A restrained system keeps the evidence legible for reviewers.",
        mood: "analytical", layoutLogic: "One claim per slide", imageLogic: "No decorative imagery", avoid: ["cards"],
      },
      slideDirectives: [
        { slideId: "title", layout: "hero" as const, layoutFamily: "opening_hero" as const, dominantVisual: "headline" as const, informationShape: "declaration" as const, composition: "Hero", visualAssetType: "none" as const, imageNeed: "none" as const, emphasis: "Title", avoid: [] },
        { slideId: "close", layout: "statement" as const, layoutFamily: "closing_statement" as const, dominantVisual: "headline" as const, informationShape: "synthesis" as const, composition: "Close", visualAssetType: "none" as const, imageNeed: "none" as const, emphasis: "Action", avoid: [] },
      ],
    };

    expect(visualSystemConnectionIssues(narrative, visualSystem).map((issue) => issue.code)).toContain("ART_DIRECTOR_SLIDE_MAP");
  });

  it("rejects repeated layout families in a five-slide Art Director handoff", () => {
    const ids = ["title", "evidence", "compare", "second-evidence", "close"];
    const narrative = {
      title: "Deck", subtitle: "", audience: "Team", thesis: "Decision", language: "en" as const,
      slides: ids.map((id, index) => ({
        id,
        visualRole: (index === 0 ? "declaration" : index === ids.length - 1 ? "action" : "explanation") as const,
        claim: id, purpose: id, visiblePoints: [], presenterNote: "",
      })),
    };
    const base = { visualAssetType: "none" as const, imageNeed: "none" as const, emphasis: "message", avoid: [] };
    const visualSystem = {
      aestheticIntent: {
        theme: "mono_evidence" as const, rationale: "A restrained system keeps the evidence legible for reviewers.",
        mood: "analytical", layoutLogic: "Content-led silhouettes", imageLogic: "No decorative imagery", avoid: ["template repetition"],
      },
      slideDirectives: [
        { ...base, slideId: "title", layout: "hero" as const, layoutFamily: "opening_hero" as const, dominantVisual: "headline" as const, informationShape: "declaration" as const, composition: "Hero" },
        { ...base, slideId: "evidence", layout: "evidence_focus" as const, layoutFamily: "evidence_list" as const, dominantVisual: "evidence" as const, informationShape: "evidence" as const, composition: "Evidence" },
        { ...base, slideId: "compare", layout: "split" as const, layoutFamily: "comparison_panels" as const, dominantVisual: "comparison" as const, informationShape: "comparison" as const, composition: "Compare" },
        { ...base, slideId: "second-evidence", layout: "evidence_focus" as const, layoutFamily: "evidence_list" as const, dominantVisual: "evidence" as const, informationShape: "evidence" as const, composition: "Evidence again" },
        { ...base, slideId: "close", layout: "statement" as const, layoutFamily: "closing_statement" as const, dominantVisual: "headline" as const, informationShape: "synthesis" as const, composition: "Close" },
      ],
    };

    expect(visualSystemConnectionIssues(narrative, visualSystem).map((issue) => issue.code)).toContain("LAYOUT_FAMILY_REPEAT");
  });
});
