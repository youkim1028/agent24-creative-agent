import { unlink } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("../src/config.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/config.js")>();
  return {
    config: {
      ...actual.config,
      mockOpenAI: true,
      mockXai: true,
      agentArchitecture: "team" as const,
    },
  };
});

const { runAgent } = await import("../src/agent/runner.js");
const { traceEvents } = await import("../src/events/event-bus.js");
const { TEAM_AGENT_ROLES } = await import("../src/team/team-runner.js");

describe("keyless team rehearsal", () => {
  it("rehearses both research platforms and exactly six connected agent roles", async () => {
    traceEvents.clear();
    const result = await runAgent({
      brief: "AI 발표 도구에 대한 최근 반응",
      slideCount: 3,
      language: "ko",
      purpose: "파이프라인 점검",
      audience: "해커톤 심사위원",
      presentationContext: "리허설",
      userVoice: "근거 중심",
      visualPreference: "절제된 편집 디자인",
      targetMarkets: [],
      fromDate: null,
      toDate: null,
      allowedHandles: [],
    }, "mock-team-test");

    const events = traceEvents.getHistory().filter((event) => event.runId === "mock-team-test");
    const roles = events
      .filter((event) => (event.payload as { type?: string }).type === "agent_call")
      .map((event) => (event.payload as { agent: string }).agent);
    const youtube = events.find((event) => (event.payload as { type?: string; mock?: boolean }).type === "youtube_search_result");
    const hackerNews = events.find((event) => (event.payload as { type?: string; mock?: boolean }).type === "hacker_news_search_result");
    const research = events.find((event) => (event.payload as { type?: string }).type === "community_research_result");
    const resolvedContext = events.find((event) => (event.payload as { state?: string }).state === "presentation_context_resolved");
    const handoffs = events.filter((event) => (event.payload as { state?: string }).state === "agent_handoff");

    expect(result.mode).toBe("mock");
    expect(roles).toEqual(TEAM_AGENT_ROLES);
    expect((youtube?.payload as { mock?: boolean }).mock).toBe(true);
    expect((hackerNews?.payload as { mock?: boolean }).mock).toBe(true);
    expect((research?.payload as { posts?: unknown[] }).posts).toHaveLength(3);
    expect((resolvedContext?.payload as { presentation_profile?: { audience?: string } }).presentation_profile?.audience).toBe("해커톤 심사위원");
    expect(handoffs).toHaveLength(8);

    if (result.artifact) {
      await Promise.all([
        unlink(path.resolve("artifacts", result.artifact.filename)),
        unlink(path.resolve("artifacts", result.artifact.jsonFilename)),
      ]);
    }
  });
});
