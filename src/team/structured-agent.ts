import OpenAI from "openai";
import { z } from "zod";
import { traceEvents } from "../events/event-bus.js";

export interface AgentCallUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export interface StructuredAgentResult<T> {
  data: T;
  usage: AgentCallUsage;
}

const MAX_ATTEMPTS = 2;
const FEEDBACK_OUTPUT_PREVIEW_CHARS = 2000;

// OpenAI strict json_schema rejects format values outside this set — zod's
// .url() emits format:"uri", which 400s the whole request. Unsupported formats
// are stripped here; the zod safeParse after the call still enforces them.
const OPENAI_SUPPORTED_FORMATS = new Set(["date-time", "time", "date", "duration", "email", "hostname", "ipv4", "ipv6", "uuid"]);

function stripUnsupportedFormats(node: unknown): void {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) {
    node.forEach(stripUnsupportedFormats);
    return;
  }
  const record = node as Record<string, unknown>;
  if (typeof record.format === "string" && !OPENAI_SUPPORTED_FORMATS.has(record.format)) {
    delete record.format;
  }
  Object.values(record).forEach(stripUnsupportedFormats);
}

function makeNullable(prop: unknown): unknown {
  if (!prop || typeof prop !== "object" || Array.isArray(prop)) return prop;
  const record = prop as Record<string, unknown>;
  if (typeof record.type === "string") {
    if (record.type !== "null") record.type = [record.type, "null"];
    return record;
  }
  if (Array.isArray(record.type)) {
    if (!record.type.includes("null")) record.type.push("null");
    return record;
  }
  if (Array.isArray(record.anyOf)) {
    if (!record.anyOf.some((variant) => variant && typeof variant === "object" && (variant as { type?: unknown }).type === "null")) {
      record.anyOf.push({ type: "null" });
    }
    return record;
  }
  return { anyOf: [record, { type: "null" }] };
}

// OpenAI strict mode demands every property appear in `required`. Optional fields
// therefore become required-but-nullable — which is why every model-facing zod
// schema that uses .optional() must also be .nullable(), or its zod parse would
// reject the null the model is now allowed to send.
function enforceStrictRequired(node: unknown): void {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) {
    node.forEach(enforceStrictRequired);
    return;
  }
  const record = node as Record<string, unknown>;
  const properties = record.properties;
  if (properties && typeof properties === "object" && !Array.isArray(properties)) {
    const map = properties as Record<string, unknown>;
    const keys = Object.keys(map);
    const previouslyRequired = new Set(Array.isArray(record.required) ? record.required as string[] : []);
    for (const key of keys) {
      if (!previouslyRequired.has(key)) map[key] = makeNullable(map[key]);
    }
    record.required = keys;
  }
  Object.values(record).forEach(enforceStrictRequired);
}

function jsonSchema(schema: z.ZodType): Record<string, unknown> {
  const converted = z.toJSONSchema(schema, { target: "draft-7" }) as Record<string, unknown>;
  delete converted.$schema;
  stripUnsupportedFormats(converted);
  enforceStrictRequired(converted);
  return converted;
}

export async function callStructuredAgent<T>(args: {
  client: OpenAI;
  runId: string;
  agent: string;
  stage?: "initial" | "repair" | "recheck";
  instructions: string;
  input: unknown;
  schemaName: string;
  schema: z.ZodType<T>;
  maxOutputTokens: number;
  model: string;
  reasoningEffort: "none" | "low" | "medium" | "high" | "xhigh" | "max";
  serviceTier: "auto" | "default" | "flex" | "priority";
}): Promise<StructuredAgentResult<T>> {
  const usage: AgentCallUsage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
  const baseInput = [{ role: "user" as const, content: JSON.stringify(args.input) }];
  let repairFeedback: string | null = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const request: OpenAI.Responses.ResponseCreateParamsNonStreaming = {
      model: args.model,
      instructions: args.instructions,
      input: repairFeedback ? [...baseInput, { role: "user" as const, content: repairFeedback }] : baseInput,
      reasoning: { effort: args.reasoningEffort },
      service_tier: args.serviceTier,
      text: {
        verbosity: "low",
        format: {
          type: "json_schema",
          name: args.schemaName,
          strict: true,
          schema: jsonSchema(args.schema),
        },
      },
      max_output_tokens: args.maxOutputTokens,
      store: false,
    };

    // The trace event carries the same object handed to the SDK, so the second screen
    // cannot drift from the request that was actually sent.
    traceEvents.emit(args.runId, "tool_call", { type: "agent_call", agent: args.agent, stage: args.stage ?? "initial", attempt, request });

    const response = await args.client.responses.create(request);

    // Emitted before parsing so a contract violation is still visible on the second screen.
    traceEvents.emit(args.runId, "tool_result", {
      type: "agent_result",
      agent: args.agent,
      stage: args.stage ?? "initial",
      attempt,
      status: response.status ?? null,
      model: response.model ?? null,
      service_tier: response.service_tier ?? null,
      incomplete_details: response.incomplete_details ?? null,
      usage: response.usage ?? null,
      output: response.output,
      output_text: response.output_text,
    });

    usage.inputTokens += response.usage?.input_tokens ?? 0;
    usage.outputTokens += response.usage?.output_tokens ?? 0;
    usage.totalTokens += response.usage?.total_tokens ?? 0;

    if (response.status === "incomplete") {
      // Retrying against the same cap would truncate again, so fail fast instead.
      throw new Error(
        `${args.agent} stopped before finishing (${response.incomplete_details?.reason ?? "unknown"}). ` +
        `Reasoning tokens count against its ${args.maxOutputTokens}-token cap; raise the role cap or lower the configured reasoning effort.`,
      );
    }

    let violation: string | null = null;
    let parsed: unknown;
    try {
      parsed = JSON.parse(response.output_text);
    } catch {
      violation = "the reply was not valid JSON";
    }

    if (violation === null) {
      const result = args.schema.safeParse(parsed);
      if (result.success) return { data: result.data, usage };
      violation = result.error.issues
        .slice(0, 5)
        .map((issue) => `${issue.path.join(".") || "root"}: ${issue.message}`)
        .join("; ");
      traceEvents.emit(args.runId, "error", {
        type: "agent_contract_violation",
        agent: args.agent,
        stage: args.stage ?? "initial",
        attempt,
        will_retry: attempt < MAX_ATTEMPTS,
        schema: args.schemaName,
        issues: result.error.issues,
      });
    } else {
      traceEvents.emit(args.runId, "error", {
        type: "agent_contract_violation",
        agent: args.agent,
        stage: args.stage ?? "initial",
        attempt,
        will_retry: attempt < MAX_ATTEMPTS,
        schema: args.schemaName,
        issues: [{ message: violation }],
      });
    }

    if (attempt === MAX_ATTEMPTS) {
      throw new Error(`${args.agent} broke the ${args.schemaName} contract after ${MAX_ATTEMPTS} attempts: ${violation}.`);
    }
    repairFeedback =
      `Your previous reply violated the ${args.schemaName} contract: ${violation}. ` +
      `Reply again with a single JSON object that satisfies the ${args.schemaName} schema exactly. ` +
      `Previous reply (may be truncated): ${response.output_text.slice(0, FEEDBACK_OUTPUT_PREVIEW_CHARS)}`;
  }

  throw new Error(`${args.agent} did not produce a valid ${args.schemaName}.`);
}
