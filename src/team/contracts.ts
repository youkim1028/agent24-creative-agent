import { z } from "zod";
import {
  aestheticIntentSchema,
  deckSchema,
  slideSchema,
  visualDirectiveContractIssues,
  visualDirectiveSchema,
  visualRoleSchema,
  visualSilhouetteKey,
} from "../deck/schema.js";
import { selectedImageSchema } from "../images/contracts.js";

export const presentationProfileSchema = z.object({
  purpose: z.string().min(1).max(240),
  audience: z.string().min(1).max(160),
  presentationContext: z.string().min(1).max(240),
  userVoice: z.string().min(1).max(240),
  visualPreference: z.string().min(1).max(240),
  assumptions: z.array(z.string().min(1).max(180)).max(5),
});

export const researchPlanSchema = z.object({
  presentationProfile: presentationProfileSchema,
  // Sentence-form queries for Grok's semantic X search only.
  topicQuery: z.string().min(3).max(240),
  designCritiqueQuery: z.string().min(3).max(240),
  // Short keyword queries for YouTube and Hacker News keyword matching; the 60-char
  // cap exists because sentence-form queries return zero results on both.
  topicKeywordQuery: z.string().min(3).max(60),
  designCritiqueKeywordQuery: z.string().min(3).max(60),
  markets: z.array(z.object({
    country: z.string().min(1).max(60),
    searchLanguage: z.string().min(2).max(12),
  })).min(1).max(3),
  rationale: z.string().min(1).max(240),
});

export const communityPostSchema = z.object({
  lane: z.enum(["topic", "design_critique"]),
  platform: z.enum(["x", "youtube", "hacker_news"]),
  url: z.string().url(),
  title: z.string().max(180),
  author: z.string().max(80),
  community: z.string().max(80),
  excerpt: z.string().max(280),
  country: z.string().max(60),
  discoveryMarket: z.string().max(60).optional(),
  language: z.string().max(12),
  postedAt: z.string().datetime().nullable(),
  engagement: z.object({
    likes: z.number().nonnegative().nullable(),
    reposts: z.number().nonnegative().nullable(),
    score: z.number().nonnegative().nullable(),
    comments: z.number().nonnegative().nullable(),
  }),
});

const findingSchema = z.object({
  complaint: z.string().min(1).max(220),
  sourceUrls: z.array(z.string().url()).min(1).max(3),
  countries: z.array(z.string().max(60)).max(3),
  languages: z.array(z.string().max(12)).max(3),
  confidence: z.enum(["low", "medium", "high"]),
});

// The transformation step the pipeline exists for: each community complaint is
// converted into a checkable pass/fail criterion about the deck being produced.
// The Art Director designs against these criteria and the Independent Critic
// judges the finished deck with them; they never become deck content.
const rubricCriterionSchema = z.object({
  criterion: z.string().min(1).max(220),
  derivedFrom: z.string().min(1).max(200),
  sourceUrls: z.array(z.string().url()).min(1).max(3),
  category: z.enum(["narrative", "design", "editability", "readability", "cliche", "voice"]),
  severity: z.enum(["error", "warning"]),
});

export const communityEvidenceSchema = z.object({
  topicComplaints: z.array(findingSchema).max(6),
  designComplaints: z.array(findingSchema).max(6),
  designCliches: z.array(z.string().min(1).max(160)).max(6),
  rubric: z.array(rubricCriterionSchema).max(8),
  regionalDifferences: z.array(z.string().min(1).max(200)).max(4),
  contradictions: z.array(z.string().min(1).max(200)).max(4),
  sourceLimitations: z.array(z.string().min(1).max(200)).max(4),
});

// Narrative slides carry no community sources: the deck's content comes from the
// user's brief alone, and community research serves only as an evaluation rubric.
const narrativeSlideSchema = z.object({
  id: z.string().min(1).max(24),
  visualRole: visualRoleSchema,
  claim: z.string().min(1).max(120),
  purpose: z.string().min(1).max(180),
  visiblePoints: z.array(z.string().min(1).max(100)).max(4),
  presenterNote: z.string().max(500),
});

export const narrativeSpecSchema = z.object({
  title: z.string().min(1).max(80),
  subtitle: z.string().max(120),
  audience: z.string().min(1).max(120),
  thesis: z.string().min(1).max(180),
  language: z.enum(["ko", "en"]),
  slides: z.array(narrativeSlideSchema).min(3).max(5),
});

export const visualSystemSpecSchema = z.object({
  aestheticIntent: aestheticIntentSchema,
  slideDirectives: z.array(visualDirectiveSchema.extend({
    slideId: z.string().min(1).max(24),
  })).min(3).max(5),
}).superRefine((spec, context) => {
  spec.slideDirectives.forEach((directive, index) => {
    for (const issue of visualDirectiveContractIssues(directive)) {
      context.addIssue({ code: "custom", path: ["slideDirectives", index], message: issue });
    }
    if (index > 0 && visualSilhouetteKey(spec.slideDirectives[index - 1]!) === visualSilhouetteKey(directive)) {
      context.addIssue({
        code: "custom",
        path: ["slideDirectives", index, "layoutFamily"],
        message: "Adjacent slides must not repeat the same silhouette.",
      });
    }
  });
  if (spec.slideDirectives.length === 5) {
    const families = spec.slideDirectives.map((directive) => directive.layoutFamily);
    families.forEach((family, index) => {
      if (families.indexOf(family) !== index) {
        context.addIssue({
          code: "custom",
          path: ["slideDirectives", index, "layoutFamily"],
          message: "A five-slide deck should use each layoutFamily at most once.",
        });
      }
    });
  }
});

export const imageResolutionSchema = z.object({
  selected: z.array(selectedImageSchema).max(12),
  warnings: z.array(z.string().max(300)).max(20),
  searchCalls: z.number().int().nonnegative().max(24),
});

export const critiqueReportSchema = z.object({
  verdict: z.enum(["pass", "revise"]),
  scores: z.object({
    grounding: z.number().int().min(0).max(100),
    narrative: z.number().int().min(0).max(100),
    topicAestheticFit: z.number().int().min(0).max(100),
    userVoice: z.number().int().min(0).max(100),
    antiCliche: z.number().int().min(0).max(100),
  }),
  issues: z.array(z.object({
    category: z.enum(["grounding", "narrative", "design", "voice", "cliche", "readability"]),
    severity: z.enum(["warning", "error"]),
    slideId: z.string().max(24).nullable(),
    instruction: z.string().min(1).max(220),
  })).max(10),
  summary: z.string().min(1).max(300),
});

// The composer writes only the fields the model must decide (copy, archetypes).
// Citations, art direction, aesthetic intent, and images are bound afterwards by
// deterministic code in the runner, so they can never drift or be invented.
export const composedSlideSchema = slideSchema.omit({ visualDirective: true, citations: true, image: true });
export const composedDeckSchema = deckSchema.omit({ aestheticIntent: true }).extend({
  slides: z.array(composedSlideSchema).min(3).max(5),
});

export { deckSchema };
export type ResearchPlan = z.infer<typeof researchPlanSchema>;
export type PresentationProfile = z.infer<typeof presentationProfileSchema>;
export type CommunityPost = z.infer<typeof communityPostSchema>;
export type CommunityEvidence = z.infer<typeof communityEvidenceSchema>;
export type NarrativeSpec = z.infer<typeof narrativeSpecSchema>;
export type VisualSystemSpec = z.infer<typeof visualSystemSpecSchema>;
export type ImageResolution = z.infer<typeof imageResolutionSchema>;
export type CritiqueReport = z.infer<typeof critiqueReportSchema>;
export type ComposedDeck = z.infer<typeof composedDeckSchema>;
