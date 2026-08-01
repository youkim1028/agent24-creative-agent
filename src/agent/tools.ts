import { z } from "zod";
import { config } from "../config.js";
import { deckSchema, type DeckArtifact, type DeckSpec } from "../deck/schema.js";
import { fatalIssues, validateDeck } from "../deck/validate.js";
import { evaluateDeck, type DeckEvaluation } from "../deck/evaluate.js";
import { renderDeck } from "../deck/render.js";
import { researchX } from "../providers/xai.js";

const researchSchema = z.object({
  query: z.string().min(3).max(500),
  markets: z.array(z.object({
    country: z.string().min(1).max(60),
    search_language: z.string().min(2).max(12),
  })).min(1).max(3),
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
const noArgumentSchema = z.object({});

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
      "Use Grok's server-side X Search to retrieve a bounded set of real complaint posts and direct source URLs from the pre-resolved markets.",
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
    name: "evaluate_deck",
    description:
      "Score the exact DeckSpec already stored by successful validation; takes no deck argument to prevent duplicate tokens or post-validation changes.",
    strict: true,
    parameters: jsonSchema(noArgumentSchema),
  },
  {
    type: "function" as const,
    name: "render_deck",
    description:
      "Render the exact validated and evaluated DeckSpec stored in this run; takes no deck argument.",
    strict: true,
    parameters: jsonSchema(noArgumentSchema),
  },
];

export interface ToolContext {
  runId: string;
  researchCompleted?: boolean;
  outlineReviewed?: boolean;
  validatedDeckFingerprint?: string;
  validatedDeck?: DeckSpec;
  evaluatedDeckFingerprint?: string;
  evaluationReady?: boolean;
  rendered?: boolean;
  forceMockX?: boolean;
}

export function availableToolDefinitions(context: ToolContext): typeof toolDefinitions {
  const name = context.rendered
    ? null
    : !context.researchCompleted
      ? "research_x"
      : !context.outlineReviewed
        ? "review_outline"
        : !context.validatedDeckFingerprint
          ? "validate_deck"
          : !context.evaluationReady || context.evaluatedDeckFingerprint !== context.validatedDeckFingerprint
            ? "evaluate_deck"
            : "render_deck";
  return name ? toolDefinitions.filter((tool) => tool.name === name) : [];
}

export interface ToolExecution {
  output: string;
  deck?: DeckSpec;
  artifact?: DeckArtifact;
  evaluation?: DeckEvaluation;
  usage?: { inputTokens: number; outputTokens: number; totalTokens: number };
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
          markets: input.markets.map((market) => ({ country: market.country, searchLanguage: market.search_language })),
          maxPosts: config.xMaxPosts,
          fromDate: input.from_date,
          toDate: input.to_date,
          allowedHandles: input.allowed_x_handles,
        },
        context.runId,
        context.forceMockX,
      );
      const { usage, ...toolResult } = result;
      context.researchCompleted = result.ok;
      return {
        output: JSON.stringify({ ...toolResult, extract: toolResult.extract.slice(0, 3200) }),
        usage,
      };
    }

    if (name === "review_outline") {
      const result = reviewOutline(outlineSchema.parse(parsed));
      context.outlineReviewed = result.ok === true;
      return { output: JSON.stringify(result) };
    }

    if (name === "validate_deck") {
      const input = deckArgumentSchema.parse(parsed);
      const validation = validateDeck(input.deck);
      const errors = fatalIssues(validation.issues);
      context.validatedDeckFingerprint = errors.length === 0 && validation.deck
        ? JSON.stringify(validation.deck)
        : undefined;
      context.validatedDeck = errors.length === 0 && validation.deck ? validation.deck : undefined;
      context.evaluatedDeckFingerprint = undefined;
      context.evaluationReady = false;
      return {
        output: JSON.stringify({
          ok: errors.length === 0,
          issues: validation.issues,
          fatal_count: errors.length,
          next_step: errors.length === 0 ? "The same deck may now be evaluated." : "Revise only the reported defects, then validate again.",
        }),
        deck: input.deck,
      };
    }

    if (name === "evaluate_deck") {
      noArgumentSchema.parse(parsed);
      if (!context.validatedDeck || !context.validatedDeckFingerprint) {
        return { output: JSON.stringify({ ok: false, error: "UNVALIDATED_DECK", message: "Validate a complete deck in this run before evaluation." }) };
      }
      const fingerprint = context.validatedDeckFingerprint;
      const evaluation = evaluateDeck(context.validatedDeck);
      context.evaluationReady = evaluation.ready;
      context.evaluatedDeckFingerprint = evaluation.ready ? fingerprint : undefined;
      const deck = context.validatedDeck;
      if (!evaluation.ready) {
        context.validatedDeckFingerprint = undefined;
        context.validatedDeck = undefined;
      }
      return { output: JSON.stringify(evaluation), deck, evaluation };
    }

    if (name === "render_deck") {
      noArgumentSchema.parse(parsed);
      if (!context.validatedDeck) {
        return { output: JSON.stringify({ ok: false, error: "UNVALIDATED_DECK", message: "No validated deck is stored for this run." }) };
      }
      const validation = validateDeck(context.validatedDeck);
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
      if (!context.evaluationReady || context.evaluatedDeckFingerprint !== JSON.stringify(validation.deck)) {
        return {
          output: JSON.stringify({
            ok: false,
            error: "UNEVALUATED_DECK",
            message: "Call evaluate_deck successfully for this exact validated deck before rendering.",
          }),
        };
      }
      const artifact = await renderDeck(validation.deck);
      context.rendered = true;
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
