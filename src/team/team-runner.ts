import OpenAI from "openai";
import { z } from "zod";
import { config } from "../config.js";
import { evaluateDeck, type DeckEvaluation } from "../deck/evaluate.js";
import { renderDeck } from "../deck/render.js";
import { deckSchema, type Citation, type DeckSpec } from "../deck/schema.js";
import { fatalIssues, validateDeck, type DeckIssue } from "../deck/validate.js";
import { traceEvents } from "../events/event-bus.js";
import { researchReddit } from "../providers/reddit.js";
import { researchX, type XResearchResult } from "../providers/xai.js";
import { resolveResearchMarkets, type ResearchMarket } from "../research/markets.js";
import type { AgentRequest, AgentResult } from "../agent/runner.js";
import {
  communityEvidenceSchema,
  communityPostSchema,
  critiqueReportSchema,
  narrativeSpecSchema,
  researchPlanSchema,
  visualSystemSpecSchema,
  type CommunityPost,
  type CommunityEvidence,
  type CritiqueReport,
  type NarrativeSpec,
} from "./contracts.js";
import {
  ART_DIRECTOR_PROMPT,
  DECK_COMPOSER_PROMPT,
  DECK_REPAIR_PROMPT,
  EVIDENCE_ANALYST_PROMPT,
  INDEPENDENT_CRITIC_PROMPT,
  NARRATIVE_ARCHITECT_PROMPT,
  RESEARCH_PLANNER_PROMPT,
} from "./prompts.js";
import { callStructuredAgent, type AgentCallUsage } from "./structured-agent.js";

const ROLE_TOKEN_LIMITS = {
  planner: 800,
  evidence: 1400,
  narrative: 1800,
  artDirector: 1400,
  composer: 2600,
  critic: 1200,
  repair: 2600,
};

export const TEAM_AGENT_MODEL_TIERS = {
  research_planner: "fast",
  evidence_analyst: "fast",
  narrative_architect: "quality",
  art_director: "quality",
  deck_composer: "quality",
  independent_critic: "critic",
  independent_critic_recheck: "critic",
  deck_repairer: "quality",
} as const;

export function modelForTeamAgent(agent: string): string {
  const tier = TEAM_AGENT_MODEL_TIERS[agent as keyof typeof TEAM_AGENT_MODEL_TIERS] ?? "quality";
  if (tier === "fast") return config.fastModel;
  if (tier === "critic") return config.criticModel;
  return config.qualityModel;
}

function addUsage(target: AgentCallUsage, value: AgentCallUsage): void {
  target.inputTokens += value.inputTokens;
  target.outputTokens += value.outputTokens;
  target.totalTokens += value.totalTokens;
}

function detectLanguage(value: string): string {
  if (/[가-힣]/u.test(value)) return "ko";
  if (/[ぁ-んァ-ン]/u.test(value)) return "ja";
  if (/[一-鿿]/u.test(value)) return "zh";
  return "en";
}

function xPosts(result: XResearchResult, lane: "topic" | "design_critique", markets: ResearchMarket[]): CommunityPost[] {
  if (result.mode === "mock") return [];
  return result.citations.flatMap((citation) => {
    const parsed = communityPostSchema.safeParse({
      lane,
      platform: "x",
      url: citation.url,
      title: citation.title,
      author: citation.handle,
      community: "X",
      excerpt: citation.excerpt,
      country: "",
      language: detectLanguage(citation.excerpt || citation.title),
      postedAt: null,
      engagement: { score: null, comments: null },
    });
    return parsed.success ? [parsed.data] : [];
  }).slice(0, Math.max(1, Math.ceil(config.xMaxPosts / 2)) * markets.length);
}

function sourceCatalog(posts: CommunityPost[]): Citation[] {
  const seen = new Set<string>();
  return posts.flatMap((post) => {
    if (seen.has(post.url)) return [];
    seen.add(post.url);
    return [{ url: post.url, title: post.title || `${post.platform} community post`, handle: post.author, excerpt: post.excerpt }];
  }).slice(0, 12);
}

function unsupportedSourceIssues(deck: DeckSpec, catalog: Citation[]): DeckIssue[] {
  const allowed = new Set(catalog.map((source) => source.url));
  return deck.slides.flatMap((slide) => slide.citations
    .filter((citation) => !allowed.has(citation.url))
    .map((citation) => ({
      code: "UNRESEARCHED_SOURCE",
      severity: "error" as const,
      slideId: slide.id,
      message: `Citation was not present in the team research catalog: ${citation.url}`,
    })));
}

function requestConsistencyIssues(deck: DeckSpec, request: AgentRequest): DeckIssue[] {
  return [
    ...(deck.slides.length > request.slideCount ? [{
      code: "SLIDE_CEILING",
      severity: "error" as const,
      slideId: null,
      message: `Deck has ${deck.slides.length} slides but the requested ceiling is ${request.slideCount}.`,
    }] : []),
    ...(deck.language !== request.language ? [{
      code: "LANGUAGE_MISMATCH",
      severity: "error" as const,
      slideId: null,
      message: `Deck language ${deck.language} does not match requested language ${request.language}.`,
    }] : []),
  ];
}

function boundEvidenceSources(evidence: CommunityEvidence, catalog: Citation[]): CommunityEvidence {
  const allowed = new Set(catalog.map((source) => source.url));
  const bound = (findings: CommunityEvidence["topicComplaints"]): CommunityEvidence["topicComplaints"] => findings
    .map((finding) => ({ ...finding, sourceUrls: finding.sourceUrls.filter((url) => allowed.has(url)) }))
    .filter((finding) => finding.sourceUrls.length > 0);
  return {
    ...evidence,
    topicComplaints: bound(evidence.topicComplaints),
    designComplaints: bound(evidence.designComplaints),
  };
}

function boundNarrativeSources(narrative: NarrativeSpec, catalog: Citation[]): NarrativeSpec {
  const allowed = new Set(catalog.map((source) => source.url));
  return {
    ...narrative,
    slides: narrative.slides.map((slide) => ({
      ...slide,
      evidenceUrls: slide.evidenceUrls.filter((url) => allowed.has(url)),
    })),
  };
}

export async function runTeamAgent(request: AgentRequest, runId: string): Promise<AgentResult> {
  const client = new OpenAI({ apiKey: config.apiKey });
  const markets = resolveResearchMarkets(request.language, request.targetMarkets);
  const openaiUsage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
  const xaiUsage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
  let agentCalls = 0;

  async function runRole<T>(args: {
    agent: string;
    instructions: string;
    input: unknown;
    schemaName: string;
    schema: z.ZodType<T>;
    maxOutputTokens: number;
  }): Promise<T> {
    if (openaiUsage.totalTokens + xaiUsage.totalTokens >= config.agentMaxTotalTokens) {
      throw new Error(`Team token budget reached before ${args.agent}. Review the trace before increasing AGENT_MAX_TOTAL_TOKENS.`);
    }
    const result = await callStructuredAgent({ client, runId, model: modelForTeamAgent(args.agent), ...args });
    addUsage(openaiUsage, result.usage);
    agentCalls += 1;
    return result.data;
  }

  traceEvents.emit(runId, "status", { state: "team_started", architecture: "team", markets });
  const brief = {
    brief: request.brief,
    purpose: request.purpose,
    audience: request.audience,
    presentationContext: request.presentationContext,
    userVoice: request.userVoice,
    visualPreference: request.visualPreference,
    slideCount: request.slideCount,
    language: request.language,
    markets,
    modelContext: {
      primaryGenerationModel: config.qualityModel,
      criticModel: config.criticModel,
      renderer: "PptxGenJS deterministic renderer",
    },
  };

  const planned = await runRole({
    agent: "research_planner",
    instructions: RESEARCH_PLANNER_PROMPT,
    input: brief,
    schemaName: "research_plan",
    schema: researchPlanSchema,
    maxOutputTokens: ROLE_TOKEN_LIMITS.planner,
  });
  const plan = { ...planned, markets };
  const perLaneXLimit = Math.max(2, Math.floor(config.xMaxPosts / 2));
  const perLaneRedditLimit = Math.max(2, Math.floor(config.redditMaxPosts / 2));

  traceEvents.emit(runId, "status", { state: "community_research", x_calls: 2, reddit_calls: config.redditEnabled ? 2 : 0 });
  const [topicX, designX, topicReddit, designReddit] = await Promise.all([
    researchX({ query: plan.topicQuery, markets, maxPosts: perLaneXLimit, fromDate: request.fromDate, toDate: request.toDate, allowedHandles: request.allowedHandles }, runId),
    researchX({ query: plan.designCritiqueQuery, markets, maxPosts: perLaneXLimit, fromDate: request.fromDate, toDate: request.toDate, allowedHandles: request.allowedHandles }, runId),
    researchReddit({ lane: "topic", query: plan.topicQuery, markets, subredditHints: plan.subredditHints, maxPosts: perLaneRedditLimit }),
    researchReddit({ lane: "design_critique", query: plan.designCritiqueQuery, markets, subredditHints: plan.subredditHints, maxPosts: perLaneRedditLimit }),
  ]);
  addUsage(xaiUsage, topicX.usage);
  addUsage(xaiUsage, designX.usage);

  const posts = [
    ...xPosts(topicX, "topic", markets),
    ...xPosts(designX, "design_critique", markets),
    ...topicReddit.posts,
    ...designReddit.posts,
  ];
  const catalog = sourceCatalog(posts);
  const researchWarnings = [topicX.warning, designX.warning, topicReddit.warning, designReddit.warning].filter(Boolean);
  traceEvents.emit(runId, "tool_result", {
    type: "community_research_result",
    x_posts: posts.filter((post) => post.platform === "x").length,
    reddit_posts: posts.filter((post) => post.platform === "reddit").length,
    warnings: researchWarnings,
  });

  const evidenceDraft = await runRole({
    agent: "evidence_analyst",
    instructions: EVIDENCE_ANALYST_PROMPT,
    input: { plan, posts, warnings: researchWarnings },
    schemaName: "community_evidence",
    schema: communityEvidenceSchema,
    maxOutputTokens: ROLE_TOKEN_LIMITS.evidence,
  });
  const evidence = boundEvidenceSources(evidenceDraft, catalog);
  const narrativeDraft = await runRole({
    agent: "narrative_architect",
    instructions: NARRATIVE_ARCHITECT_PROMPT,
    input: { brief, evidence, sourceCatalog: catalog },
    schemaName: "narrative_spec",
    schema: narrativeSpecSchema,
    maxOutputTokens: ROLE_TOKEN_LIMITS.narrative,
  });
  const narrative = boundNarrativeSources(narrativeDraft, catalog);
  const visualSystem = await runRole({
    agent: "art_director",
    instructions: ART_DIRECTOR_PROMPT,
    input: { brief, evidence, narrative },
    schemaName: "visual_system_spec",
    schema: visualSystemSpecSchema,
    maxOutputTokens: ROLE_TOKEN_LIMITS.artDirector,
  });
  let deck = await runRole({
    agent: "deck_composer",
    instructions: DECK_COMPOSER_PROMPT,
    input: { narrative, visualSystem, sourceCatalog: catalog },
    schemaName: "deck_spec",
    schema: deckSchema,
    maxOutputTokens: ROLE_TOKEN_LIMITS.composer,
  });

  let validation = validateDeck(deck);
  let codeIssues = [...validation.issues, ...unsupportedSourceIssues(deck, catalog), ...requestConsistencyIssues(deck, request)];
  let evaluation: DeckEvaluation = evaluateDeck(deck);
  let critique: CritiqueReport = await runRole({
    agent: "independent_critic",
    instructions: INDEPENDENT_CRITIC_PROMPT,
    input: { brief, evidence, narrative, visualSystem, deck },
    schemaName: "critique_report",
    schema: critiqueReportSchema,
    maxOutputTokens: ROLE_TOKEN_LIMITS.critic,
  });

  const needsRepair = critique.verdict === "revise" || fatalIssues(codeIssues).length > 0 || !evaluation.ready;
  if (needsRepair) {
    deck = await runRole({
      agent: "deck_repairer",
      instructions: DECK_REPAIR_PROMPT,
      input: { existingDeck: deck, critique, codeIssues, evaluation, narrative, visualSystem, sourceCatalog: catalog },
      schemaName: "repaired_deck_spec",
      schema: deckSchema,
      maxOutputTokens: ROLE_TOKEN_LIMITS.repair,
    });
    validation = validateDeck(deck);
    codeIssues = [...validation.issues, ...unsupportedSourceIssues(deck, catalog), ...requestConsistencyIssues(deck, request)];
    evaluation = evaluateDeck(deck);
    critique = await runRole({
      agent: "independent_critic_recheck",
      instructions: INDEPENDENT_CRITIC_PROMPT,
      input: { brief, evidence, narrative, visualSystem, deck },
      schemaName: "critique_recheck",
      schema: critiqueReportSchema,
      maxOutputTokens: ROLE_TOKEN_LIMITS.critic,
    });
  }

  const fatal = fatalIssues(codeIssues);
  if (!validation.deck || fatal.length > 0 || !evaluation.ready || critique.verdict !== "pass") {
    traceEvents.emit(runId, "error", { state: "team_gate_failed", fatal_count: fatal.length, evaluation, critique });
    throw new Error(`Team quality gate failed: ${fatal.length} fatal code issue(s), evaluation ${evaluation.score}, critic ${critique.verdict}.`);
  }

  const artifact = await renderDeck(validation.deck);
  traceEvents.emit(runId, "status", { state: "completed", architecture: "team", agent_calls: agentCalls, rendered: true });
  return {
    runId,
    output: request.language === "ko"
      ? `팀 검증을 통과한 PPTX가 생성되었습니다: ${artifact.downloadUrl} 커뮤니티 게시물은 대화의 증거이며 사실의 자동 증명은 아닙니다.`
      : `The team-reviewed PPTX is ready: ${artifact.downloadUrl} Community posts evidence conversation, not automatic factual truth.`,
    model: config.qualityModel,
    grokModel: config.grokModel,
    mode: "openai",
    architecture: "team",
    xMode: config.mockXai ? "mock" : "xai",
    rounds: agentCalls,
    deck: validation.deck,
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
