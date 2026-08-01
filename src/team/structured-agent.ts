import OpenAI from "openai";
import { z } from "zod";
import { config } from "../config.js";
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

function jsonSchema(schema: z.ZodType): Record<string, unknown> {
  const converted = z.toJSONSchema(schema, { target: "draft-7" }) as Record<string, unknown>;
  delete converted.$schema;
  return converted;
}

export async function callStructuredAgent<T>(args: {
  client: OpenAI;
  runId: string;
  agent: string;
  instructions: string;
  input: unknown;
  schemaName: string;
  schema: z.ZodType<T>;
  maxOutputTokens: number;
  model: string;
}): Promise<StructuredAgentResult<T>> {
  const content = JSON.stringify(args.input);
  traceEvents.emit(args.runId, "tool_call", {
    type: "agent_call",
    agent: args.agent,
    model: args.model,
    input_chars: content.length,
    max_output_tokens: args.maxOutputTokens,
  });

  const response = await args.client.responses.create({
    model: args.model,
    instructions: args.instructions,
    input: [{ role: "user", content }],
    reasoning: { effort: config.reasoningEffort },
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
  });

  const usage = {
    inputTokens: response.usage?.input_tokens ?? 0,
    outputTokens: response.usage?.output_tokens ?? 0,
    totalTokens: response.usage?.total_tokens ?? 0,
  };
  let parsed: unknown;
  try {
    parsed = JSON.parse(response.output_text);
  } catch {
    throw new Error(`${args.agent} returned invalid JSON.`);
  }
  const data = args.schema.parse(parsed);
  traceEvents.emit(args.runId, "tool_result", {
    type: "agent_result",
    agent: args.agent,
    usage,
    output_chars: response.output_text.length,
  });
  return { data, usage };
}
