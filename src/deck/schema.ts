import { z } from "zod";

export const citationSchema = z.object({
  url: z.string().url(),
  title: z.string().min(1).max(160),
  handle: z.string().max(80),
  excerpt: z.string().max(280),
});

export const statSchema = z.object({
  value: z.string().min(1).max(24),
  label: z.string().min(1).max(72),
});

export const slideSchema = z.object({
  id: z.string().min(1).max(24),
  archetype: z.enum(["title", "claim", "stat", "two_col", "process", "bullets", "closing"]),
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
  slides: z.array(slideSchema).min(3).max(5),
});

export type Citation = z.infer<typeof citationSchema>;
export type SlideSpec = z.infer<typeof slideSchema>;
export type DeckSpec = z.infer<typeof deckSchema>;

export interface DeckArtifact {
  filename: string;
  jsonFilename: string;
  downloadUrl: string;
  jsonUrl: string;
}

