import { z } from "zod";

export const citationSchema = z.object({
  url: z.string().url(),
  title: z.string().min(1).max(160),
  handle: z.string().max(80),
  excerpt: z.string().max(280),
  postedAt: z.string().datetime().nullable().optional(),
  engagement: z.object({
    likes: z.number().nonnegative().nullable(),
    reposts: z.number().nonnegative().nullable(),
    comments: z.number().nonnegative().nullable(),
  }).optional(),
});

export const statSchema = z.object({
  value: z.string().min(1).max(24),
  label: z.string().min(1).max(72),
});

export const aestheticIntentSchema = z.object({
  theme: z.enum(["ink_acid", "editorial_light", "warm_documentary", "mono_evidence"]),
  rationale: z.string().min(1).max(240),
  mood: z.string().min(1).max(100),
  layoutLogic: z.string().min(1).max(180),
  imageLogic: z.string().min(1).max(180),
  avoid: z.array(z.string().min(1).max(80)).max(6),
});

export const visualRoleSchema = z.enum([
  "declaration",
  "evidence",
  "explanation",
  "case",
  "transition",
  "synthesis",
  "action",
]);

export const slideSchema = z.object({
  id: z.string().min(1).max(24),
  archetype: z.enum(["title", "claim", "stat", "two_col", "process", "bullets", "closing"]),
  visualRole: visualRoleSchema,
  eyebrow: z.string().max(40),
  title: z.string().min(1).max(80),
  takeaway: z.string().max(160),
  bullets: z.array(z.string().min(1).max(120)).max(5),
  stats: z.array(statSchema).max(3),
  notes: z.string().max(800),
  citations: z.array(citationSchema).max(6),
});

export const deckSchema = z.object({
  title: z.string().min(1).max(80),
  subtitle: z.string().max(120),
  audience: z.string().min(1).max(120),
  thesis: z.string().min(1).max(180),
  language: z.enum(["ko", "en"]),
  aestheticIntent: aestheticIntentSchema,
  slides: z.array(slideSchema).min(3).max(5),
});

export type Citation = z.infer<typeof citationSchema>;
export type SlideSpec = z.infer<typeof slideSchema>;
export type AestheticIntent = z.infer<typeof aestheticIntentSchema>;
export type DeckSpec = z.infer<typeof deckSchema>;

export interface DeckArtifact {
  filename: string;
  jsonFilename: string;
  downloadUrl: string;
  jsonUrl: string;
}
