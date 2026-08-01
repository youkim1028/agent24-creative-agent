import { z } from "zod";
import { deckSchema, type DeckArtifact, type DeckSpec } from "../deck/schema.js";
import { fatalIssues, validateDeck } from "../deck/validate.js";
import { renderDeck } from "../deck/render.js";
import { researchX } from "../providers/xai.js";

const researchSchema = z.object({
  query: z.string().min(3).max(500),
  from_date: z.string().nullable(),
  to_date: z.string().nullable(),
  allowed_x_handles: z.array(z.string().min(1).max(80)).max(20),
});

const outlineSchema = z.object({
  thesis: z.string().min(1).max(180),
  audience: z.string().min(1).max(120),
  beats: z.array(
    z.object({
      position: z.number().int().positive(),
      claim: z.string().min(1).max(160),
      evidence_needed: z.string().min(1).max(180),
    }),
  ).min(1).max(3),
});

const deckArgumentSchema = z.object({ deck: deckSchema });

function jsonSchema(schema: z.ZodType): Record<string, unknown> {
  const converted = z.toJSONSchema(schema, { target: "draft-7" }) as Record<string, unknown>;
  delete converted.$schema;
  return converted;
}

export const toolDefinitions = [
  {
    type: "function" as const,
    name: "research_x",
    description:
      "Use Grok's server-side X Search to collect current X posts, disagreements, sentiment, and source URLs before making a deck about a live topic.",
    strict: true,
    parameters: jsonSchema(researchSchema),
  },
  {
    type: "function" as const,
    name: "review_outline",
    description:
      "Check that a short deck outline forms an argument rather than a table of contents, before slide bodies are written.",
    strict: true,
    parameters: jsonSchema(outlineSchema),
  },
  {
    type: "function" as const,
    name: "validate_deck",
    description:
      "Run deterministic checks for slide count, argument takeaways, text density, unique IDs, and source grounding before rendering.",
    strict: true,
    parameters: jsonSchema(deckArgumentSchema),
  },
  {
    type: "function" as const,
    name: "render_deck",
    description:
      "Render a deck that already passes deterministic validation into downloadable PPTX and JSON artifacts.",
    strict: true,
    parameters: jsonSchema(deckArgumentSchema),
  },
];

export interface ToolContext {
  runId: string;
  validatedDeckFingerprint?: string;
  forceMockX?: boolean;
}

export interface ToolExecution {
  output: string;
  deck?: DeckSpec;
  artifact?: DeckArtifact;
}

function reviewOutline(input: z.infer<typeof outlineSchema>): Record<string, unknown> {
  const positions = input.beats.map((beat) => beat.position);
  const sequential = positions.every((position, index) => position === index + 1);
  const generic = input.beats.filter((beat) =>
    /^(배경|현황|분석|결론|background|overview|analysis|conclusion)$/iu.test(beat.claim.trim()),
  );
  const issues = [
    ...(sequential ? [] : ["Beat positions must be sequential from 1."]),
    ...generic.map((beat) => `Beat ${beat.position} is a topic label, not a claim.`),
  ];
  return {
    ok: issues.length === 0,
    thesis: input.thesis,
    beat_count: input.beats.length,
    issues,
    next_step: issues.length === 0 ? "Build slide bodies without changing this order." : "Revise the outline, then review it again.",
  };
}

export async function executeTool(
  name: string,
  rawArguments: string,
  context: ToolContext,
): Promise<ToolExecution> {
  try {
    const parsed: unknown = JSON.parse(rawArguments);

    if (name === "research_x") {
      const input = researchSchema.parse(parsed);
      const result = await researchX(
        {
          query: input.query,
          fromDate: input.from_date,
          toDate: input.to_date,
          allowedHandles: input.allowed_x_handles,
        },
        context.runId,
        context.forceMockX,
      );
      return { output: JSON.stringify(result) };
    }

    if (name === "review_outline") {
      return { output: JSON.stringify(reviewOutline(outlineSchema.parse(parsed))) };
    }

    if (name === "validate_deck") {
      const input = deckArgumentSchema.parse(parsed);
      const validation = validateDeck(input.deck);
      const errors = fatalIssues(validation.issues);
      context.validatedDeckFingerprint = errors.length === 0 && validation.deck
        ? JSON.stringify(validation.deck)
        : undefined;
      return {
        output: JSON.stringify({
          ok: errors.length === 0,
          issues: validation.issues,
          fatal_count: errors.length,
          next_step: errors.length === 0 ? "The same deck may now be rendered." : "Revise only the reported defects, then validate again.",
        }),
        deck: input.deck,
      };
    }

    if (name === "render_deck") {
      const input = deckArgumentSchema.parse(parsed);
      const validation = validateDeck(input.deck);
      const errors = fatalIssues(validation.issues);
      if (!validation.deck || errors.length > 0) {
        return { output: JSON.stringify({ ok: false, error: "Deck failed the render gate.", issues: validation.issues }) };
      }
      if (context.validatedDeckFingerprint !== JSON.stringify(validation.deck)) {
        return {
          output: JSON.stringify({
            ok: false,
            error: "UNVALIDATED_DECK",
            message: "Call validate_deck successfully for this exact deck in the same run before rendering.",
          }),
        };
      }
      const artifact = await renderDeck(validation.deck);
      return {
        output: JSON.stringify({ ok: true, artifact, warnings: validation.issues.filter((issue) => issue.severity === "warning") }),
        deck: validation.deck,
        artifact,
      };
    }

    return { output: JSON.stringify({ ok: false, error: `Unknown tool: ${name}` }) };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown tool failure";
    return { output: JSON.stringify({ ok: false, error: message }) };
  }
}
