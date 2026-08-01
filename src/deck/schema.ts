import { z } from "zod";
import { imageIntentSchema, selectedImageSchema } from "../images/contracts.js";

export const citationSchema = z.object({
  url: z.string().url(),
  title: z.string().min(1).max(160),
  handle: z.string().max(80),
  excerpt: z.string().max(280),
  country: z.string().max(60).optional(),
  discoveryMarket: z.string().max(60).optional(),
  language: z.string().max(12).optional(),
  postedAt: z.string().datetime().nullable().optional(),
  engagement: z.object({
    likes: z.number().nonnegative().nullable(),
    reposts: z.number().nonnegative().nullable(),
    score: z.number().nonnegative().nullable(),
    comments: z.number().nonnegative().nullable(),
  }).optional(),
});

export const statSchema = z.object({
  value: z.string().min(1).max(24),
  label: z.string().min(1).max(72),
});

// A logo-like identity mark for the deck, generated from native PowerPoint
// shapes by deterministic code — never fetched from anywhere. The Art Director
// picks a geometry whose form echoes the topic; code draws it on the covers.
export const emblemSchema = z.object({
  kind: z.enum(["concentric_rings", "orbit_dot", "dot_grid", "line_stack", "triangle_peak"]),
  rationale: z.string().min(1).max(160),
});

export const aestheticIntentSchema = z.object({
  theme: z.enum(["ink_acid", "editorial_light", "warm_documentary", "mono_evidence"]),
  rationale: z.string().min(1).max(240),
  mood: z.string().min(1).max(100),
  layoutLogic: z.string().min(1).max(180),
  imageLogic: z.string().min(1).max(180),
  avoid: z.array(z.string().min(1).max(80)).max(6),
  emblem: emblemSchema.nullable().optional(),
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

export const visualLayoutSchema = z.enum([
  "hero",
  "evidence_focus",
  "split",
  "steps",
  "statement",
  "image_focus",
  "image_left",
  "chart_focus",
  "diagram_flow",
  "timeline",
  "spatial_map",
]);

export const dominantVisualSchema = z.enum([
  "headline",
  "image",
  "evidence",
  "comparison",
  "sequence",
  "data",
  "relationship",
]);

export const informationShapeSchema = z.enum([
  "declaration",
  "evidence",
  "comparison",
  "sequence",
  "chronology",
  "spatial",
  "synthesis",
]);

export const layoutFamilySchema = z.enum([
  "opening_hero",
  "closing_statement",
  "split_media",
  "evidence_list",
  "comparison_panels",
  "step_sequence",
  "data_chart",
  "process_diagram",
  "timeline",
  "spatial_map",
]);

export const visualAssetTypeSchema = z.enum([
  "none",
  "photo",
  "screenshot",
  "chart",
  "diagram",
]);

export const visualDirectiveSchema = z.object({
  layout: visualLayoutSchema,
  layoutFamily: layoutFamilySchema,
  dominantVisual: dominantVisualSchema,
  informationShape: informationShapeSchema,
  composition: z.string().min(1).max(180),
  visualAssetType: visualAssetTypeSchema,
  imageNeed: z.enum(["none", "optional", "required"]),
  imageIntent: imageIntentSchema.nullable().optional(),
  emphasis: z.string().min(1).max(140),
  avoid: z.array(z.string().min(1).max(100)).max(3),
});

export type VisualDirective = z.infer<typeof visualDirectiveSchema>;

export const LAYOUT_FAMILY_BY_LAYOUT: Record<z.infer<typeof visualLayoutSchema>, z.infer<typeof layoutFamilySchema>> = {
  hero: "opening_hero",
  statement: "closing_statement",
  image_focus: "split_media",
  image_left: "split_media",
  evidence_focus: "evidence_list",
  split: "comparison_panels",
  steps: "step_sequence",
  chart_focus: "data_chart",
  diagram_flow: "process_diagram",
  timeline: "timeline",
  spatial_map: "spatial_map",
};

const DOMINANT_VISUALS_BY_LAYOUT: Record<z.infer<typeof visualLayoutSchema>, VisualDirective["dominantVisual"][]> = {
  hero: ["headline", "image"],
  statement: ["headline", "image"],
  image_focus: ["image"],
  image_left: ["image"],
  evidence_focus: ["evidence"],
  split: ["comparison"],
  steps: ["sequence"],
  chart_focus: ["data"],
  diagram_flow: ["relationship"],
  timeline: ["sequence", "relationship"],
  spatial_map: ["relationship"],
};

const INFORMATION_SHAPES_BY_LAYOUT: Record<z.infer<typeof visualLayoutSchema>, VisualDirective["informationShape"][]> = {
  hero: ["declaration"],
  statement: ["synthesis", "declaration"],
  image_focus: ["declaration", "evidence", "spatial"],
  image_left: ["declaration", "evidence", "spatial"],
  evidence_focus: ["evidence"],
  split: ["comparison"],
  steps: ["sequence"],
  chart_focus: ["comparison", "evidence"],
  diagram_flow: ["sequence", "comparison", "spatial"],
  timeline: ["chronology"],
  spatial_map: ["spatial"],
};

export function visualDirectiveContractIssues(directive: VisualDirective): string[] {
  const issues: string[] = [];
  if (directive.layoutFamily !== LAYOUT_FAMILY_BY_LAYOUT[directive.layout]) {
    issues.push(`layout=${directive.layout} requires layoutFamily=${LAYOUT_FAMILY_BY_LAYOUT[directive.layout]}`);
  }
  if (!DOMINANT_VISUALS_BY_LAYOUT[directive.layout].includes(directive.dominantVisual)) {
    issues.push(`dominantVisual=${directive.dominantVisual} does not match layout=${directive.layout}`);
  }
  if (!INFORMATION_SHAPES_BY_LAYOUT[directive.layout].includes(directive.informationShape)) {
    issues.push(`informationShape=${directive.informationShape} does not match layout=${directive.layout}`);
  }
  return issues;
}

export function visualSilhouetteKey(directive: VisualDirective): string {
  if (directive.layout === "image_focus" || directive.layout === "image_left") return "split_media";
  if ((directive.layout === "hero" || directive.layout === "statement") && directive.dominantVisual === "image") return "full_bleed_image";
  return `${directive.layoutFamily}:${directive.dominantVisual}`;
}

export const slideSchema = z.object({
  id: z.string().min(1).max(24),
  archetype: z.enum(["title", "claim", "stat", "two_col", "process", "bullets", "closing"]),
  visualRole: visualRoleSchema,
  visualDirective: visualDirectiveSchema,
  eyebrow: z.string().max(40),
  title: z.string().min(1).max(80),
  takeaway: z.string().max(160),
  bullets: z.array(z.string().min(1).max(120)).max(5),
  stats: z.array(statSchema).max(3),
  notes: z.string().max(800),
  citations: z.array(citationSchema).max(6),
  image: selectedImageSchema.nullable().optional(),
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
export type Emblem = z.infer<typeof emblemSchema>;
export type SlideSpec = z.infer<typeof slideSchema>;
export type AestheticIntent = z.infer<typeof aestheticIntentSchema>;
export type DeckSpec = z.infer<typeof deckSchema>;

export interface DeckArtifact {
  filename: string;
  jsonFilename: string;
  downloadUrl: string;
  jsonUrl: string;
}
