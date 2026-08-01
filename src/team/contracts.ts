import { z } from "zod";
import { aestheticIntentSchema, deckSchema, visualRoleSchema } from "../deck/schema.js";

export const researchPlanSchema = z.object({
  topicQuery: z.string().min(3).max(240),
  designCritiqueQuery: z.string().min(3).max(240),
  markets: z.array(z.object({
    country: z.string().min(1).max(60),
    searchLanguage: z.string().min(2).max(12),
  })).min(1).max(3),
  subredditHints: z.array(z.string().min(1).max(40)).max(5),
  rationale: z.string().min(1).max(240),
});

export const communityPostSchema = z.object({
  lane: z.enum(["topic", "design_critique"]),
  platform: z.enum(["x", "reddit"]),
  url: z.string().url(),
  title: z.string().max(180),
  author: z.string().max(80),
  community: z.string().max(80),
  excerpt: z.string().max(280),
  country: z.string().max(60),
  language: z.string().max(12),
  postedAt: z.string().nullable(),
  engagement: z.object({ score: z.number().nullable(), comments: z.number().nullable() }),
});

const findingSchema = z.object({
  complaint: z.string().min(1).max(220),
  sourceUrls: z.array(z.string().url()).min(1).max(3),
  countries: z.array(z.string().max(60)).max(3),
  languages: z.array(z.string().max(12)).max(3),
  confidence: z.enum(["low", "medium", "high"]),
});

export const communityEvidenceSchema = z.object({
  topicComplaints: z.array(findingSchema).max(6),
  designComplaints: z.array(findingSchema).max(6),
  designCliches: z.array(z.string().min(1).max(160)).max(6),
  regionalDifferences: z.array(z.string().min(1).max(200)).max(4),
  contradictions: z.array(z.string().min(1).max(200)).max(4),
  sourceLimitations: z.array(z.string().min(1).max(200)).max(4),
});

const narrativeSlideSchema = z.object({
  id: z.string().min(1).max(24),
  visualRole: visualRoleSchema,
  claim: z.string().min(1).max(120),
  purpose: z.string().min(1).max(180),
  evidenceUrls: z.array(z.string().url()).max(3),
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
  slideDirectives: z.array(z.object({
    slideId: z.string().min(1).max(24),
    composition: z.string().min(1).max(180),
    imageNeed: z.enum(["none", "optional", "required"]),
    emphasis: z.string().min(1).max(140),
    avoid: z.array(z.string().min(1).max(100)).max(3),
  })).min(3).max(5),
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

export { deckSchema };
export type ResearchPlan = z.infer<typeof researchPlanSchema>;
export type CommunityPost = z.infer<typeof communityPostSchema>;
export type CommunityEvidence = z.infer<typeof communityEvidenceSchema>;
export type NarrativeSpec = z.infer<typeof narrativeSpecSchema>;
export type VisualSystemSpec = z.infer<typeof visualSystemSpecSchema>;
export type CritiqueReport = z.infer<typeof critiqueReportSchema>;
