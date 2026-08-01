import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

export const toolDefinitions = [
  {
    type: "function" as const,
    name: "analyze_brief",
    description:
      "Normalize a creative brief into an objective, audience, deliverable, and explicit hard constraints before drafting.",
    strict: true,
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        objective: { type: "string", description: "The outcome the user needs." },
        audience: { type: "string", description: "The primary intended audience." },
        deliverable: { type: "string", description: "The requested output format." },
        constraints: {
          type: "array",
          items: { type: "string" },
          description: "Testable requirements and prohibitions from the brief.",
        },
      },
      required: ["objective", "audience", "deliverable", "constraints"],
    },
  },
  {
    type: "function" as const,
    name: "review_draft",
    description:
      "Check a completed draft against explicit criteria and return concrete gaps before final delivery.",
    strict: true,
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        draft: { type: "string", description: "The full draft to inspect." },
        criteria: {
          type: "array",
          items: { type: "string" },
          description: "Specific requirements the draft must satisfy.",
        },
      },
      required: ["draft", "criteria"],
    },
  },
  {
    type: "function" as const,
    name: "save_artifact",
    description:
      "Save an approved text, Markdown, or JSON deliverable to the local artifacts directory.",
    strict: true,
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        title: { type: "string", description: "Short artifact title used for the filename." },
        content: { type: "string", description: "Complete content to save." },
        format: { type: "string", enum: ["md", "txt", "json"] },
      },
      required: ["title", "content", "format"],
    },
  },
];

const analyzeSchema = z.object({
  objective: z.string().min(1),
  audience: z.string().min(1),
  deliverable: z.string().min(1),
  constraints: z.array(z.string()).max(30),
});

const reviewSchema = z.object({
  draft: z.string().min(1).max(30_000),
  criteria: z.array(z.string().min(1)).min(1).max(30),
});

const saveSchema = z.object({
  title: z.string().min(1).max(80),
  content: z.string().min(1).max(100_000),
  format: z.enum(["md", "txt", "json"]),
});

function normalizeWords(value: string): string[] {
  return value
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((word) => word.length >= 2);
}

export async function executeTool(name: string, rawArguments: string): Promise<string> {
  try {
    const parsed: unknown = JSON.parse(rawArguments);

    if (name === "analyze_brief") {
      const input = analyzeSchema.parse(parsed);
      return JSON.stringify({
        ok: true,
        normalized_brief: input,
        constraint_count: input.constraints.length,
        next_step: "Create a draft that satisfies every listed constraint, then review it.",
      });
    }

    if (name === "review_draft") {
      const input = reviewSchema.parse(parsed);
      const draftWords = new Set(normalizeWords(input.draft));
      const checks = input.criteria.map((criterion) => {
        const keywords = normalizeWords(criterion);
        const matched = keywords.filter((word) => draftWords.has(word));
        const coverage = keywords.length === 0 ? 1 : matched.length / keywords.length;
        return {
          criterion,
          status: coverage >= 0.5 ? "likely_met" : "needs_attention",
          matched_keywords: matched,
        };
      });
      const gaps = checks.filter((check) => check.status === "needs_attention");
      return JSON.stringify({
        ok: true,
        metrics: {
          characters: input.draft.length,
          words: normalizeWords(input.draft).length,
          criteria_checked: checks.length,
        },
        checks,
        material_gaps: gaps.map((gap) => gap.criterion),
        verdict: gaps.length === 0 ? "pass" : "revise",
        caveat: "Keyword coverage is a guardrail, not a semantic quality score.",
      });
    }

    if (name === "save_artifact") {
      const input = saveSchema.parse(parsed);
      const safeName = input.title
        .normalize("NFKD")
        .replace(/[^\p{L}\p{N}]+/gu, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 60)
        .toLocaleLowerCase() || "artifact";
      const directory = path.resolve("artifacts");
      const filePath = path.join(directory, `${safeName}.${input.format}`);
      await mkdir(directory, { recursive: true });
      await writeFile(filePath, input.content, "utf8");
      return JSON.stringify({ ok: true, path: filePath, bytes: Buffer.byteLength(input.content) });
    }

    return JSON.stringify({ ok: false, error: `Unknown tool: ${name}` });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown tool failure";
    return JSON.stringify({ ok: false, error: message });
  }
}

