import OpenAI from "openai";
import { z } from "zod";
import { config } from "../config.js";
import { evaluateDeck, type DeckEvaluation } from "../deck/evaluate.js";
import { collectRecentDesigns } from "../deck/recent-designs.js";
import { renderDeck } from "../deck/render.js";
import {
  visualDirectiveContractIssues,
  visualSilhouetteKey,
  type Citation,
  type DeckSpec,
} from "../deck/schema.js";
import { fatalIssues, validateDeck, type DeckIssue } from "../deck/validate.js";
import { traceEvents } from "../events/event-bus.js";
import type { SelectedImage } from "../images/contracts.js";
import { resolveImagesForDeck } from "../images/image-service.js";
import { uploadRegistry } from "../images/upload-registry.js";
import { researchHackerNews } from "../providers/hacker-news.js";
import { researchYouTube } from "../providers/youtube.js";
import { researchX, type XResearchResult, type XSearchInput } from "../providers/xai.js";
import { resolveResearchMarkets, type ResearchMarket } from "../research/markets.js";
import type { AgentRequest, AgentResult } from "../agent/runner.js";
import {
  communityEvidenceSchema,
  communityPostSchema,
  composedDeckSchema,
  critiqueReportSchema,
  narrativeSpecSchema,
  researchPlanSchema,
  visualSystemSpecSchema,
  type ComposedDeck,
  type CommunityPost,
  type CommunityEvidence,
  type CritiqueReport,
  type NarrativeSpec,
  type PresentationProfile,
  type VisualSystemSpec,
} from "./contracts.js";
import {
  ART_DIRECTOR_PROMPT,
  DECK_COMPOSER_PROMPT,
  DECK_COMPOSER_REPAIR_PROMPT,
  EVIDENCE_ANALYST_PROMPT,
  INDEPENDENT_CRITIC_PROMPT,
  NARRATIVE_ARCHITECT_PROMPT,
  RESEARCH_PLANNER_PROMPT,
} from "./prompts.js";
import { callStructuredAgent, type AgentCallUsage } from "./structured-agent.js";

// `max_output_tokens` also contains hidden reasoning tokens. Keep each role's
// ceiling configurable so high-effort roles cannot lose their structured answer
// to an undersized hard-coded cap.
export const ROLE_TOKEN_LIMITS = config.teamRoleTokenLimits;

export const TEAM_AGENT_ROLES = [
  "research_planner",
  "evidence_analyst",
  "narrative_architect",
  "art_director",
  "deck_composer",
  "independent_critic",
] as const;

export type TeamAgentRole = typeof TEAM_AGENT_ROLES[number];

export const TEAM_AGENT_MODEL_TIERS: Record<TeamAgentRole, "fast" | "critical"> = {
  research_planner: "fast",
  evidence_analyst: "fast",
  narrative_architect: "critical",
  art_director: "critical",
  deck_composer: "critical",
  independent_critic: "critical",
};

export function modelForTeamAgent(agent: TeamAgentRole): string {
  // The critic can be pinned to a different model family (OPENAI_CRITIC_MODEL) so
  // the deck is not reviewed by the same model that composed it.
  if (agent === "independent_critic") return config.criticModel;
  return TEAM_AGENT_MODEL_TIERS[agent] === "critical" ? config.criticalModel : config.fastModel;
}

// Reasoning depth is routed per role, not per model tier: only the narrative
// architect — whose judgment gates everything downstream — earns deep effort.
// The other critical roles produce heavily constrained outputs (enum layouts,
// copy fields, a bounded critique), where extra reasoning mostly adds latency
// and consumes the role's own output cap.
export const TEAM_AGENT_REASONING_DEPTH: Record<TeamAgentRole, "fast" | "standard" | "deep"> = {
  research_planner: "fast",
  evidence_analyst: "fast",
  narrative_architect: "deep",
  art_director: "standard",
  deck_composer: "standard",
  independent_critic: "standard",
};

export function executionForTeamAgent(agent: TeamAgentRole): {
  model: string;
  reasoningEffort: typeof config.reasoningEffort;
  serviceTier: typeof config.serviceTier;
} {
  const critical = TEAM_AGENT_MODEL_TIERS[agent] === "critical";
  const depth = TEAM_AGENT_REASONING_DEPTH[agent];
  return {
    model: modelForTeamAgent(agent),
    reasoningEffort: depth === "deep"
      ? config.criticalReasoningEffort
      : depth === "standard" ? config.standardReasoningEffort : config.reasoningEffort,
    serviceTier: critical ? config.criticalServiceTier : config.serviceTier,
  };
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

function xPosts(result: XResearchResult, lane: "topic" | "design_critique"): CommunityPost[] {
  if (result.mode === "mock") return [];
  return result.citations.flatMap((citation) => {
    // A citation without body text cannot support any finding; letting it into
    // the catalog would let slides cite URLs no analyst ever read.
    if (!citation.excerpt.trim()) return [];
    const parsed = communityPostSchema.safeParse({
      lane,
      platform: "x",
      url: citation.url,
      title: citation.title,
      author: citation.handle,
      community: "X",
      excerpt: citation.excerpt,
      country: citation.country ?? "",
      language: citation.language || detectLanguage(citation.excerpt || citation.title),
      postedAt: citation.postedAt ?? null,
      engagement: {
        likes: citation.engagement?.likes ?? null,
        reposts: citation.engagement?.reposts ?? null,
        score: citation.engagement?.score ?? null,
        comments: citation.engagement?.comments ?? null,
      },
    });
    return parsed.success ? [parsed.data] : [];
  });
}

export function splitResearchLimit(total: number): { topic: number; designCritique: number } {
  return { topic: Math.ceil(total / 2), designCritique: Math.floor(total / 2) };
}

export function applyPresentationOverrides(
  inferred: PresentationProfile,
  request: Pick<AgentRequest, "purpose" | "audience" | "presentationContext" | "userVoice" | "visualPreference">,
): PresentationProfile {
  return {
    purpose: request.purpose.trim() || inferred.purpose,
    audience: request.audience.trim() || inferred.audience,
    presentationContext: request.presentationContext.trim() || inferred.presentationContext,
    userVoice: request.userVoice.trim() || inferred.userVoice,
    visualPreference: request.visualPreference.trim() || inferred.visualPreference,
    assumptions: inferred.assumptions,
  };
}

// A failed lane must not take the whole run down: the other lane and YouTube can still
// supply evidence, and the analyst is told about the gap through researchWarnings.
async function safeResearchX(input: XSearchInput, runId: string, lane: string): Promise<XResearchResult> {
  try {
    return await researchX(input, runId);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown X search failure";
    traceEvents.emit(runId, "error", { type: "x_search_failed", lane, message });
    return {
      ok: false,
      mode: "xai",
      model: config.grokModel,
      lane: input.lane,
      query: input.query,
      markets: input.markets,
      extract: "",
      citations: [],
      usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      cache: "disabled",
      warning: `X search failed for the ${lane} lane: ${message}`,
    };
  }
}

function sourceCatalog(posts: CommunityPost[]): Citation[] {
  const seen = new Set<string>();
  return posts.flatMap((post) => {
    if (seen.has(post.url)) return [];
    seen.add(post.url);
    return [{
      url: post.url,
      title: post.title || `${post.platform} community post`,
      handle: post.author,
      excerpt: post.excerpt,
      country: post.country,
      discoveryMarket: post.discoveryMarket,
      language: post.language,
      postedAt: post.postedAt,
      engagement: post.engagement,
    }];
  }).slice(0, 16);
}

function dedupePosts(posts: CommunityPost[]): CommunityPost[] {
  const seen = new Set<string>();
  return posts.filter((post) => {
    if (seen.has(post.url)) return false;
    seen.add(post.url);
    return true;
  });
}

export function visualSystemConnectionIssues(
  narrative: NarrativeSpec,
  visualSystem: VisualSystemSpec,
): DeckIssue[] {
  const issues: DeckIssue[] = [];
  const expectedIds = narrative.slides.map((slide) => slide.id);
  const actualIds = visualSystem.slideDirectives.map((directive) => directive.slideId);
  if (JSON.stringify(expectedIds) !== JSON.stringify(actualIds)) {
    issues.push({
      code: "ART_DIRECTOR_SLIDE_MAP",
      severity: "error",
      slideId: null,
      message: "Art Director directives must match every NarrativeSpec slide ID in the same order.",
    });
  }
  for (const directive of visualSystem.slideDirectives) {
    for (const issue of visualDirectiveContractIssues(directive)) {
      issues.push({
        code: "VISUAL_INTENT_MISMATCH",
        severity: "error",
        slideId: directive.slideId,
        message: issue,
      });
    }
    const externalVisual = directive.visualAssetType === "photo" || directive.visualAssetType === "screenshot";
    if (externalVisual && directive.imageNeed === "none") {
      issues.push({
        code: "VISUAL_ASSET_NEED_MISMATCH",
        severity: "error",
        slideId: directive.slideId,
        message: "Photo and screenshot assets must set imageNeed to optional or required.",
      });
    }
    if (!externalVisual && directive.imageNeed !== "none") {
      issues.push({
        code: "VISUAL_ASSET_NEED_MISMATCH",
        severity: "error",
        slideId: directive.slideId,
        message: "Only photo and screenshot assets may request an external image.",
      });
    }
    if (externalVisual && !directive.imageIntent) {
      issues.push({
        code: "IMAGE_INTENT_MISSING",
        severity: "error",
        slideId: directive.slideId,
        message: "Every photo or screenshot must have a concrete ImageIntent.",
      });
    }
    if (!externalVisual && directive.imageIntent) {
      issues.push({
        code: "UNUSED_IMAGE_INTENT",
        severity: "error",
        slideId: directive.slideId,
        message: "imageIntent is only valid for photo or screenshot assets.",
      });
    }
    if (externalVisual && !["hero", "statement", "image_focus", "image_left"].includes(directive.layout)) {
      issues.push({
        code: "IMAGE_LAYOUT_MISMATCH",
        severity: "error",
        slideId: directive.slideId,
        message: "Image-led body slides must use image_focus; only title/closing may use hero or statement with an image.",
      });
    }
    if (directive.visualAssetType === "chart" && directive.layout !== "chart_focus") {
      issues.push({
        code: "CHART_LAYOUT_MISMATCH",
        severity: "error",
        slideId: directive.slideId,
        message: "Chart assets must use the chart_focus layout.",
      });
    }
    if (directive.layout === "chart_focus" && directive.visualAssetType !== "chart") {
      issues.push({
        code: "CHART_ASSET_MISMATCH",
        severity: "error",
        slideId: directive.slideId,
        message: "The chart_focus layout requires visualAssetType=chart.",
      });
    }
    if (directive.visualAssetType === "diagram" && !["diagram_flow", "timeline", "spatial_map"].includes(directive.layout)) {
      issues.push({
        code: "DIAGRAM_LAYOUT_MISMATCH",
        severity: "error",
        slideId: directive.slideId,
        message: "Diagram assets must use the diagram_flow layout.",
      });
    }
    if (["diagram_flow", "timeline", "spatial_map"].includes(directive.layout) && directive.visualAssetType !== "diagram") {
      issues.push({
        code: "DIAGRAM_ASSET_MISMATCH",
        severity: "error",
        slideId: directive.slideId,
        message: "The diagram_flow layout requires visualAssetType=diagram.",
      });
    }
    if (["image_focus", "image_left"].includes(directive.layout) && !externalVisual) {
      issues.push({
        code: "IMAGE_ASSET_MISMATCH",
        severity: "error",
        slideId: directive.slideId,
        message: "The image_focus layout requires a photo or screenshot asset.",
      });
    }
    if (directive.visualAssetType === "screenshot" && directive.imageIntent?.preferredSource === "stock") {
      issues.push({
        code: "SCREENSHOT_STOCK_SOURCE",
        severity: "error",
        slideId: directive.slideId,
        message: "Screenshots must come from a user upload or allowlisted official URL, never stock search.",
      });
    }
  }
  visualSystem.slideDirectives.forEach((directive, index) => {
    if (index === 0) return;
    const previous = visualSystem.slideDirectives[index - 1]!;
    if (visualSilhouetteKey(previous) === visualSilhouetteKey(directive)) {
      issues.push({
        code: "ADJACENT_SILHOUETTE_REPEAT",
        severity: "error",
        slideId: directive.slideId,
        message: `Adjacent slides ${previous.slideId} and ${directive.slideId} repeat the same silhouette.`,
      });
    }
  });
  if (visualSystem.slideDirectives.length === 5) {
    const seenFamilies = new Set<string>();
    for (const directive of visualSystem.slideDirectives) {
      if (seenFamilies.has(directive.layoutFamily)) {
        issues.push({
          code: "LAYOUT_FAMILY_REPEAT",
          severity: "error",
          slideId: directive.slideId,
          message: `A five-slide deck may use layoutFamily=${directive.layoutFamily} only once.`,
        });
      }
      seenFamilies.add(directive.layoutFamily);
    }
  }
  return issues;
}

export function bindSelectedImages(deck: DeckSpec, selected: SelectedImage[]): DeckSpec {
  const bySlide = new Map(selected.map((image) => [image.slideId, image]));
  return {
    ...deck,
    slides: deck.slides.map((slide) => ({ ...slide, image: bySlide.get(slide.id) })),
  };
}

export function imageResolutionIssues(visualSystem: VisualSystemSpec, selected: SelectedImage[]): DeckIssue[] {
  const selectedIds = new Set(selected.map((image) => image.slideId));
  return visualSystem.slideDirectives.flatMap((directive) => (
    directive.imageNeed === "required" && !selectedIds.has(directive.slideId)
      ? [{
        code: "REQUIRED_IMAGE_UNAVAILABLE",
        severity: "error" as const,
        slideId: directive.slideId,
        message: "A required image could not be resolved and downloaded in this run.",
      }]
      : []
  ));
}

const UNBOUND_DIRECTIVE: DeckSpec["slides"][number]["visualDirective"] = {
  layout: "statement",
  layoutFamily: "closing_statement",
  dominantVisual: "headline",
  informationShape: "synthesis",
  composition: "Unbound slide: no matching Art Director directive exists for this slide ID.",
  visualAssetType: "none",
  imageNeed: "none",
  emphasis: "unbound",
  avoid: [],
};

// The composer writes only copy; art direction and aesthetic intent are bound
// here from the upstream contracts (keyed by slide ID), so they cannot drift or
// be invented by the model. Slides carry no community citations at all: community
// research is an evaluation rubric, never deck content.
function bindDeckContracts(
  composed: ComposedDeck,
  narrative: NarrativeSpec,
  visualSystem: VisualSystemSpec,
): DeckSpec {
  const directives = new Map(visualSystem.slideDirectives.map(({ slideId, ...directive }) => [slideId, directive]));
  return {
    ...composed,
    aestheticIntent: visualSystem.aestheticIntent,
    slides: composed.slides.map((slide) => ({
      ...slide,
      visualDirective: directives.get(slide.id) ?? UNBOUND_DIRECTIVE,
      citations: [],
    })),
  };
}

// Fail-closed guard for the rubric boundary: community posts must never surface
// in the deck copy. Match on post URLs, handles, and long excerpt prefixes.
export function communityLeakIssues(deck: DeckSpec, posts: CommunityPost[]): DeckIssue[] {
  const normalize = (value: string): string => value.replace(/\s+/g, " ").toLowerCase();
  const issues: DeckIssue[] = [];
  for (const slide of deck.slides) {
    const slideText = normalize([
      slide.eyebrow, slide.title, slide.takeaway, ...slide.bullets, slide.notes,
      ...slide.stats.flatMap((stat) => [stat.value, stat.label]),
    ].join("\n"));
    for (const post of posts) {
      const handle = post.author.replace(/^@/, "").toLowerCase();
      const markers = [post.url.toLowerCase()];
      if (handle.length >= 4) markers.push(`@${handle}`);
      const excerpt = normalize(post.excerpt);
      if (excerpt.length >= 30) markers.push(excerpt.slice(0, 60));
      if (markers.some((marker) => slideText.includes(marker))) {
        issues.push({
          code: "COMMUNITY_CONTENT_LEAK",
          severity: "error",
          slideId: slide.id,
          message: `Community post content leaked into the deck copy: ${post.url}`,
        });
        break;
      }
    }
  }
  return issues;
}

// Citations and art direction are code-bound, so only the fields the composer still
// controls — slide identity, order, and visual roles — can drift from the narrative.
function deckHandoffIssues(deck: DeckSpec, narrative: NarrativeSpec): DeckIssue[] {
  const issues: DeckIssue[] = [];
  const narrativeById = new Map(narrative.slides.map((slide) => [slide.id, slide]));
  if (JSON.stringify(deck.slides.map((slide) => slide.id)) !== JSON.stringify(narrative.slides.map((slide) => slide.id))) {
    issues.push({ code: "NARRATIVE_ORDER_DRIFT", severity: "error", slideId: null, message: "Deck slide IDs/order drifted from NarrativeSpec." });
  }
  for (const slide of deck.slides) {
    const narrativeSlide = narrativeById.get(slide.id);
    if (!narrativeSlide || slide.visualRole !== narrativeSlide.visualRole) {
      issues.push({ code: "NARRATIVE_ROLE_DRIFT", severity: "error", slideId: slide.id, message: "Deck visualRole drifted from NarrativeSpec." });
    }
  }
  return issues;
}

function emitHandoff(runId: string, from: string, to: string, contract: string, detail: Record<string, unknown> = {}): void {
  traceEvents.emit(runId, "status", { state: "agent_handoff", from, to, contract, ...detail });
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

// Dropped URLs are returned so the caller can put the removal on the trace; a
// silently narrowed evidence base would undermine the audit story.
function boundEvidenceSources(
  evidence: CommunityEvidence,
  catalog: Citation[],
): { evidence: CommunityEvidence; droppedUrls: string[] } {
  const allowed = new Set(catalog.map((source) => source.url));
  const droppedUrls: string[] = [];
  const bound = (findings: CommunityEvidence["topicComplaints"]): CommunityEvidence["topicComplaints"] => findings
    .map((finding) => ({
      ...finding,
      sourceUrls: finding.sourceUrls.filter((url) => {
        if (allowed.has(url)) return true;
        droppedUrls.push(url);
        return false;
      }),
    }))
    .filter((finding) => finding.sourceUrls.length > 0);
  return {
    evidence: {
      ...evidence,
      topicComplaints: bound(evidence.topicComplaints),
      designComplaints: bound(evidence.designComplaints),
      // Rubric criteria must stay traceable to real posts; a criterion whose
      // every source was dropped is an invented standard and is removed.
      rubric: evidence.rubric
        .map((criterion) => ({
          ...criterion,
          sourceUrls: criterion.sourceUrls.filter((url) => {
            if (allowed.has(url)) return true;
            droppedUrls.push(url);
            return false;
          }),
        }))
        .filter((criterion) => criterion.sourceUrls.length > 0),
    },
    droppedUrls,
  };
}


export async function runTeamAgent(request: AgentRequest, runId: string): Promise<AgentResult> {
  const client = new OpenAI({ apiKey: config.apiKey });
  const markets = resolveResearchMarkets(request.language, request.targetMarkets);
  const openaiUsage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
  const xaiUsage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
  let agentCalls = 0;

  async function runRole<T>(args: {
    agent: TeamAgentRole;
    stage?: "initial" | "repair" | "recheck";
    instructions: string;
    input: unknown;
    schemaName: string;
    schema: z.ZodType<T>;
    maxOutputTokens: number;
  }): Promise<T> {
    // Checked against the role's own output cap so an underfunded run stops before
    // spending on a call it can no longer afford, not one call later. Only GPT usage
    // draws from this budget: Grok's X-search input tokens routinely reach six
    // figures (it bills every post it reads) and are bounded separately by
    // GROK_MAX_OUTPUT_TOKENS and the fixed two search calls per run.
    if (openaiUsage.totalTokens + args.maxOutputTokens > config.agentMaxTotalTokens) {
      throw new Error(
        `GPT token budget cannot cover the ${args.agent} response cap (${args.maxOutputTokens} tokens). ` +
        `Review the trace before increasing AGENT_MAX_TOTAL_TOKENS.`,
      );
    }
    const result = await callStructuredAgent({ client, runId, ...executionForTeamAgent(args.agent), ...args });
    addUsage(openaiUsage, result.usage);
    agentCalls += 1;
    return result.data;
  }

  // Fail before any spend when the budget cannot even cover the six-role initial
  // path; discovering that at the composer would waste the whole research phase.
  const initialPathOutputTokens = ROLE_TOKEN_LIMITS.planner + ROLE_TOKEN_LIMITS.evidence + ROLE_TOKEN_LIMITS.narrative
    + ROLE_TOKEN_LIMITS.artDirector + ROLE_TOKEN_LIMITS.composer + ROLE_TOKEN_LIMITS.critic;
  if (config.agentMaxTotalTokens < initialPathOutputTokens) {
    throw new Error(
      `AGENT_MAX_TOTAL_TOKENS (${config.agentMaxTotalTokens}) is below the ${initialPathOutputTokens} output tokens ` +
      `the six-role pipeline can require before inputs and reasoning are counted. Raise the budget before running.`,
    );
  }

  traceEvents.emit(runId, "status", { state: "team_started", architecture: "team", markets });
  const referenceInputs = {
    uploadedImages: config.userUploadsEnabled ? uploadRegistry.publicMany(request.uploadedAssetIds ?? []) : [],
    officialImageUrls: config.officialImagesEnabled ? request.officialImageUrls ?? [] : [],
    designReferenceUrls: config.dribbbleReferencesEnabled ? request.designReferenceUrls ?? [] : [],
    capabilities: {
      pexels: config.pexelsEnabled,
      unsplash: config.unsplashEnabled,
      officialAllowlist: config.officialImagesEnabled,
      userUploads: config.userUploadsEnabled,
      designReferenceLinks: config.dribbbleReferencesEnabled,
      nativePowerPointCharts: true,
      nativePowerPointDiagrams: true,
    },
    privacyBoundary: "Uploaded image bytes stay local. Agents receive labels and dimensions only.",
  };
  const intake = {
    brief: request.brief,
    additionalContext: request.additionalContext?.trim() || "",
    explicitOverrides: {
      purpose: request.purpose.trim() || null,
      audience: request.audience.trim() || null,
      presentationContext: request.presentationContext.trim() || null,
      userVoice: request.userVoice.trim() || null,
      visualPreference: request.visualPreference.trim() || null,
    },
    slideCount: request.slideCount,
    language: request.language,
    markets,
    modelContext: {
      primaryGenerationModel: config.criticalModel,
      criticModel: config.criticModel,
      renderer: "PptxGenJS deterministic renderer",
    },
  };

  const planned = await runRole({
    agent: "research_planner",
    stage: "initial",
    instructions: RESEARCH_PLANNER_PROMPT,
    input: intake,
    schemaName: "research_plan",
    schema: researchPlanSchema,
    maxOutputTokens: ROLE_TOKEN_LIMITS.planner,
  });
  const presentationProfile = applyPresentationOverrides(planned.presentationProfile, request);
  const plan = { ...planned, presentationProfile, markets };
  const brief = {
    brief: request.brief,
    additionalContext: intake.additionalContext,
    presentationProfile,
    slideCount: request.slideCount,
    language: request.language,
    markets,
  };
  const explicitFields = Object.entries(intake.explicitOverrides)
    .filter(([, value]) => value !== null)
    .map(([field]) => field);
  traceEvents.emit(runId, "status", {
    state: "presentation_context_resolved",
    presentation_profile: presentationProfile,
    explicit_fields: explicitFields,
    inferred_fields: ["purpose", "audience", "presentationContext", "userVoice", "visualPreference"]
      .filter((field) => !explicitFields.includes(field)),
    additional_context_used: intake.additionalContext.length > 0,
  });
  emitHandoff(runId, "research_planner", "x_youtube_hn_retrieval_tools", "ResearchPlan", { lanes: ["topic", "design_critique"], markets });
  const xLimits = splitResearchLimit(config.xMaxPosts);
  const youtubeLimits = splitResearchLimit(config.youtubeMaxPosts);
  const hackerNewsLimits = splitResearchLimit(config.hackerNewsMaxPosts);

  traceEvents.emit(runId, "status", {
    state: "community_research",
    x_calls: 2,
    youtube_lanes: config.youtubeEnabled ? 2 : 0,
    hacker_news_lanes: config.hackerNewsEnabled ? 2 : 0,
  });
  // Research measures the AI-ness of this pipeline's own model class, not the
  // brief's subject, so the cache key is model-scoped: every run — regardless of
  // brief — shares the same rubric research within the TTL. This also caps the
  // expensive Grok X-search spend at roughly one live search per model per day.
  const cacheSeed = `ai-slop-rubric/v1/${config.criticalModel}/pptxgenjs`;
  const [topicX, designX, topicYouTube, designYouTube, topicHackerNews, designHackerNews] = await Promise.all([
    safeResearchX({ lane: "topic", query: plan.topicQuery, cacheSeed, markets, maxPosts: xLimits.topic, fromDate: request.fromDate, toDate: request.toDate, allowedHandles: request.allowedHandles }, runId, "topic"),
    safeResearchX({ lane: "design_critique", query: plan.designCritiqueQuery, cacheSeed, markets, maxPosts: xLimits.designCritique, fromDate: request.fromDate, toDate: request.toDate, allowedHandles: request.allowedHandles }, runId, "design_critique"),
    researchYouTube({ lane: "topic", query: plan.topicKeywordQuery, cacheSeed, markets, maxPosts: youtubeLimits.topic, fromDate: request.fromDate, toDate: request.toDate }, runId),
    researchYouTube({ lane: "design_critique", query: plan.designCritiqueKeywordQuery, cacheSeed, markets, maxPosts: youtubeLimits.designCritique, fromDate: request.fromDate, toDate: request.toDate }, runId),
    researchHackerNews({ lane: "topic", query: plan.topicKeywordQuery, cacheSeed, markets, maxPosts: hackerNewsLimits.topic, fromDate: request.fromDate, toDate: request.toDate }, runId),
    researchHackerNews({ lane: "design_critique", query: plan.designCritiqueKeywordQuery, cacheSeed, markets, maxPosts: hackerNewsLimits.designCritique, fromDate: request.fromDate, toDate: request.toDate }, runId),
  ]);
  addUsage(xaiUsage, topicX.usage);
  addUsage(xaiUsage, designX.usage);

  const posts = dedupePosts([
    ...xPosts(topicX, "topic"),
    ...xPosts(designX, "design_critique"),
    ...topicYouTube.posts,
    ...designYouTube.posts,
    ...topicHackerNews.posts,
    ...designHackerNews.posts,
  ]);
  const catalog = sourceCatalog(posts);
  // The analyst must only see posts it is allowed to cite: anything outside the
  // capped catalog would otherwise be analyzed and then silently unbound later.
  const catalogUrls = new Set(catalog.map((source) => source.url));
  const analystPosts = posts.filter((post) => catalogUrls.has(post.url));
  const researchWarnings = [topicX.warning, designX.warning, topicYouTube.warning, designYouTube.warning, topicHackerNews.warning, designHackerNews.warning].filter(Boolean);
  if (analystPosts.length < posts.length) {
    researchWarnings.push(
      `The source catalog is capped at ${catalog.length} URLs, so ${posts.length - analystPosts.length} collected posts were excluded before analysis.`,
    );
  }
  traceEvents.emit(runId, "status", {
    state: "community_research_handoff",
    type: "community_research_result",
    x_posts: posts.filter((post) => post.platform === "x").length,
    youtube_comments: posts.filter((post) => post.platform === "youtube").length,
    hacker_news_items: posts.filter((post) => post.platform === "hacker_news").length,
    posts,
    source_catalog: catalog,
    memory: {
      enabled: config.gcsMemoryEnabled,
      x: { topic: topicX.cache, design_critique: designX.cache },
      youtube: { topic: topicYouTube.cache, design_critique: designYouTube.cache },
      hacker_news: { topic: topicHackerNews.cache, design_critique: designHackerNews.cache },
    },
    warnings: researchWarnings,
  });
  // Community research is a quality rubric, not deck content, so an empty catalog
  // no longer stops the run: the deck can still be built from the brief, and the
  // critic falls back to general judgment. The gap stays visible on the trace.
  if (catalog.length === 0) {
    researchWarnings.push(
      "No usable community posts were found; the anti-AI-cliche rubric is empty and the critic will rely on general judgment only.",
    );
    traceEvents.emit(runId, "status", { state: "community_research_empty", warnings: researchWarnings });
  }
  emitHandoff(runId, "x_youtube_hn_retrieval_tools", "evidence_analyst", "CommunityPost[]", { post_count: analystPosts.length, source_count: catalog.length });

  const evidenceDraft = await runRole({
    agent: "evidence_analyst",
    stage: "initial",
    instructions: EVIDENCE_ANALYST_PROMPT,
    input: { plan, posts: analystPosts, warnings: researchWarnings },
    schemaName: "community_evidence",
    schema: communityEvidenceSchema,
    maxOutputTokens: ROLE_TOKEN_LIMITS.evidence,
  });
  const evidenceBinding = boundEvidenceSources(evidenceDraft, catalog);
  const evidence = evidenceBinding.evidence;
  if (evidenceBinding.droppedUrls.length > 0) {
    traceEvents.emit(runId, "status", {
      state: "uncataloged_sources_dropped",
      agent: "evidence_analyst",
      dropped_urls: evidenceBinding.droppedUrls,
    });
  }
  // The rubric flows to the roles that evaluate and steer design — never to the
  // narrative, whose content comes from the user's brief alone.
  emitHandoff(runId, "evidence_analyst", "art_director", "CommunityEvidence (evaluation rubric)", {
    topic_findings: evidence.topicComplaints.length,
    design_findings: evidence.designComplaints.length,
  });
  const narrativeDraft = await runRole({
    agent: "narrative_architect",
    stage: "initial",
    instructions: NARRATIVE_ARCHITECT_PROMPT,
    input: { brief },
    schemaName: "narrative_spec",
    schema: narrativeSpecSchema,
    maxOutputTokens: ROLE_TOKEN_LIMITS.narrative,
  });
  const narrative = narrativeDraft;
  emitHandoff(runId, "narrative_architect", "art_director", "NarrativeSpec", { slide_count: narrative.slides.length });
  // Fingerprints of the latest successful decks: same-brief reruns should not
  // land on the same theme/emblem/layout rhythm run after run.
  const recentDesigns = await collectRecentDesigns();
  let visualSystem = await runRole({
    agent: "art_director",
    stage: "initial",
    instructions: ART_DIRECTOR_PROMPT,
    input: { brief, evidence, narrative, referenceInputs, recentDesigns },
    schemaName: "visual_system_spec",
    schema: visualSystemSpecSchema,
    maxOutputTokens: ROLE_TOKEN_LIMITS.artDirector,
  });
  let artConnectionIssues = visualSystemConnectionIssues(narrative, visualSystem);
  if (artConnectionIssues.length > 0) {
    // Connection contracts (asset↔layout pairing, slide-ID mapping, silhouette
    // diversity) can only be checked against the narrative after parsing, so a
    // violation gets one bounded repair pass with the exact issues as feedback —
    // the same recovery discipline as schema violations — before failing the run.
    traceEvents.emit(runId, "error", {
      type: "agent_contract_violation",
      agent: "art_director",
      stage: "initial",
      will_retry: true,
      schema: "visual_system_spec",
      issues: artConnectionIssues,
    });
    visualSystem = await runRole({
      agent: "art_director",
      stage: "repair",
      instructions: ART_DIRECTOR_PROMPT,
      input: {
        brief,
        evidence,
        narrative,
        referenceInputs,
        recentDesigns,
        previousVisualSystem: visualSystem,
        contractViolations: artConnectionIssues,
        repairInstruction: "Your previous VisualSystemSpec violated the listed contracts. Fix ONLY the violations (for example, a diagram asset must use the diagram_flow, timeline, or spatial_map layout) while keeping every valid directive unchanged. Return the complete corrected VisualSystemSpec.",
      },
      schemaName: "visual_system_spec",
      schema: visualSystemSpecSchema,
      maxOutputTokens: ROLE_TOKEN_LIMITS.artDirector,
    });
    artConnectionIssues = visualSystemConnectionIssues(narrative, visualSystem);
  }
  if (artConnectionIssues.length > 0) {
    traceEvents.emit(runId, "error", { state: "art_director_handoff_failed", issues: artConnectionIssues });
    throw new Error(`Art Director handoff failed after one repair pass: ${artConnectionIssues.map((issue) => issue.code).join(", ")}.`);
  }
  emitHandoff(runId, "art_director", "visual_asset_tools", "VisualSystemSpec", {
    directive_count: visualSystem.slideDirectives.length,
    requested_types: visualSystem.slideDirectives.map((directive) => directive.visualAssetType),
  });
  const imageResolution = await resolveImagesForDeck({
    runId,
    visualSystem,
    uploadedAssetIds: request.uploadedAssetIds ?? [],
    officialImageUrls: request.officialImageUrls ?? [],
  });
  const imageIssues = imageResolutionIssues(visualSystem, imageResolution.selected);
  if (fatalIssues(imageIssues).length > 0) {
    traceEvents.emit(runId, "error", { state: "image_handoff_failed", issues: imageIssues, warnings: imageResolution.warnings });
    throw new Error(`Image handoff failed: ${imageIssues.map((issue) => issue.code).join(", ")}.`);
  }
  traceEvents.emit(runId, "status", {
    state: "visual_assets_resolved",
    external_assets: imageResolution.selected.length,
    native_charts_planned: visualSystem.slideDirectives.filter((directive) => directive.visualAssetType === "chart").length,
    native_diagrams_planned: visualSystem.slideDirectives.filter((directive) => directive.visualAssetType === "diagram").length,
    warnings: imageResolution.warnings,
  });
  emitHandoff(runId, "visual_asset_tools", "deck_composer", "VisualAssetPlan", {
    selected_count: imageResolution.selected.length,
    native_count: visualSystem.slideDirectives.filter((directive) => ["chart", "diagram"].includes(directive.visualAssetType)).length,
    warnings: imageResolution.warnings,
  });
  const composed = await runRole({
    agent: "deck_composer",
    stage: "initial",
    instructions: DECK_COMPOSER_PROMPT,
    input: { narrative, visualSystem, imageAssets: imageResolution.selected },
    schemaName: "composed_deck",
    schema: composedDeckSchema,
    maxOutputTokens: ROLE_TOKEN_LIMITS.composer,
  });
  let deck = bindSelectedImages(bindDeckContracts(composed, narrative, visualSystem), imageResolution.selected);

  let validation = validateDeck(deck);
  let codeIssues = [
    ...validation.issues,
    ...requestConsistencyIssues(deck, request),
    ...imageIssues,
    ...deckHandoffIssues(deck, narrative),
    ...communityLeakIssues(deck, posts),
  ];
  let evaluation: DeckEvaluation = evaluateDeck(deck);
  emitHandoff(runId, "deck_composer", "independent_critic", "DeckSpec", { validation_issue_count: codeIssues.length });
  let critique: CritiqueReport = await runRole({
    agent: "independent_critic",
    stage: "initial",
    instructions: INDEPENDENT_CRITIC_PROMPT,
    input: { brief, referenceInputs, evidence, narrative, visualSystem, imageAssets: imageResolution.selected, deck },
    schemaName: "critique_report",
    schema: critiqueReportSchema,
    maxOutputTokens: ROLE_TOKEN_LIMITS.critic,
  });
  const needsRepair = critique.verdict === "revise" || fatalIssues(codeIssues).length > 0 || !evaluation.ready;
  let imageAssets = imageResolution.selected;
  if (needsRepair) {
    // The composer can only rewrite copy; when the critic rejects a photo, the
    // fix is re-resolving the image. Re-run resolution for the flagged slides
    // only, excluding the rejected assets, so the recheck sees new imagery.
    const imageRepairIds = [...new Set(critique.issues
      .filter((issue) => issue.category === "design" && issue.severity === "error" && issue.slideId)
      .map((issue) => issue.slideId as string)
      .filter((slideId) => {
        const directive = visualSystem.slideDirectives.find((entry) => entry.slideId === slideId);
        return directive ? ["photo", "screenshot"].includes(directive.visualAssetType) : false;
      }))];
    if (imageRepairIds.length > 0) {
      const rejectedAssetIds = imageAssets
        .filter((image) => imageRepairIds.includes(image.slideId))
        .map((image) => image.assetId);
      traceEvents.emit(runId, "status", { state: "image_repair", slide_ids: imageRepairIds, rejected_assets: rejectedAssetIds });
      const retry = await resolveImagesForDeck({
        runId,
        visualSystem,
        uploadedAssetIds: request.uploadedAssetIds ?? [],
        officialImageUrls: request.officialImageUrls ?? [],
        onlySlideIds: imageRepairIds,
        excludeAssetIds: rejectedAssetIds,
      });
      if (retry.selected.length > 0) {
        const replacements = new Map(retry.selected.map((image) => [image.slideId, image]));
        imageAssets = imageAssets.map((image) => replacements.get(image.slideId) ?? image);
        for (const image of retry.selected) {
          if (!imageAssets.some((existing) => existing.slideId === image.slideId)) imageAssets.push(image);
        }
      }
      imageResolution.warnings.push(...retry.warnings);
      imageResolution.searchCalls += retry.searchCalls;
      traceEvents.emit(runId, "status", {
        state: "image_repair_complete",
        replaced: retry.selected.map((image) => image.slideId),
        warnings: retry.warnings,
      });
    }
    const repaired = await runRole({
      agent: "deck_composer",
      stage: "repair",
      instructions: DECK_COMPOSER_REPAIR_PROMPT,
      input: { existingDeck: deck, critique, codeIssues, evaluation, narrative, visualSystem, imageAssets },
      schemaName: "repaired_composed_deck",
      schema: composedDeckSchema,
      maxOutputTokens: ROLE_TOKEN_LIMITS.repair,
    });
    deck = bindSelectedImages(bindDeckContracts(repaired, narrative, visualSystem), imageAssets);
    validation = validateDeck(deck);
    codeIssues = [
      ...validation.issues,
      ...requestConsistencyIssues(deck, request),
      ...imageIssues,
      ...deckHandoffIssues(deck, narrative),
      ...communityLeakIssues(deck, posts),
    ];
    evaluation = evaluateDeck(deck);
    critique = await runRole({
      agent: "independent_critic",
      stage: "recheck",
      instructions: INDEPENDENT_CRITIC_PROMPT,
      input: { brief, referenceInputs, evidence, narrative, visualSystem, imageAssets, deck },
      schemaName: "critique_recheck",
      schema: critiqueReportSchema,
      maxOutputTokens: ROLE_TOKEN_LIMITS.critic,
    });
  }

  emitHandoff(runId, "independent_critic", "deterministic_quality_gates", "CritiqueReport", {
    stage: needsRepair ? "recheck" : "initial",
    verdict: critique.verdict,
  });

  const fatal = fatalIssues(codeIssues);
  if (!validation.deck || fatal.length > 0 || !evaluation.ready || critique.verdict !== "pass") {
    const blockers = [
      ...fatal.map((issue) => `[code] ${issue.code}: ${issue.message}`),
      ...(evaluation.ready ? [] : evaluation.issues.map((issue) => `[evaluation] ${issue.code}: ${issue.message}`)),
      ...(critique.verdict === "pass" ? [] : critique.issues.filter((issue) => issue.severity === "error").map((issue) => `[critic] ${issue.instruction}`)),
    ];
    traceEvents.emit(runId, "error", {
      state: "team_gate_failed",
      fatal_count: fatal.length,
      blockers,
      code_issues: codeIssues,
      evaluation,
      critique,
    });
    const listed = blockers.slice(0, 3).join(" / ") || "no specific blocker was reported";
    // Rendering stays blocked, but the run's full spend is not discarded: the deck
    // spec and blockers go back to the caller for inspection instead of an error
    // that throws away everything the pipeline produced.
    return {
      runId,
      output: request.language === "ko"
        ? `품질 게이트가 렌더를 차단했습니다. 근거·구조 요건을 통과하지 못한 덱은 저장하지 않으며, 검토용 덱 사양과 차단 사유만 반환합니다. 차단 사유: ${listed}`
        : `The quality gate blocked rendering. A deck that fails the evidence and structure requirements is never saved; the deck spec and blockers are returned for review only. Blockers: ${listed}`,
      model: config.criticalModel,
      grokModel: config.grokModel,
      mode: "openai",
      architecture: "team",
      xMode: config.mockXai ? "mock" : "xai",
      rounds: agentCalls,
      deck: validation.deck ?? deck,
      artifact: null,
      evaluation,
      gate: { passed: false, blockers },
      usage: {
        openai: openaiUsage,
        xai: xaiUsage,
        combinedTotalTokens: openaiUsage.totalTokens + xaiUsage.totalTokens,
        budgetTokens: config.agentMaxTotalTokens,
      },
    };
  }

  const artifact = await renderDeck(validation.deck);
  traceEvents.emit(runId, "status", {
    state: "completed",
    architecture: "team",
    unique_agents: TEAM_AGENT_ROLES,
    agent_calls: agentCalls,
    rendered: true,
  });
  return {
    runId,
    output: request.language === "ko"
      ? `팀 검증을 통과한 PPTX가 생성되었습니다: ${artifact.downloadUrl} 커뮤니티 게시물은 대화의 증거이며 사실의 자동 증명은 아닙니다.`
      : `The team-reviewed PPTX is ready: ${artifact.downloadUrl} Community posts evidence conversation, not automatic factual truth.`,
    model: config.criticalModel,
    grokModel: config.grokModel,
    mode: "openai",
    architecture: "team",
    xMode: config.mockXai ? "mock" : "xai",
    rounds: agentCalls,
    deck: validation.deck,
    artifact,
    evaluation,
    gate: { passed: true, blockers: [] },
    usage: {
      openai: openaiUsage,
      xai: xaiUsage,
      combinedTotalTokens: openaiUsage.totalTokens + xaiUsage.totalTokens,
      budgetTokens: config.agentMaxTotalTokens,
    },
  };
}
