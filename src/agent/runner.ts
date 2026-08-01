import { randomUUID } from "node:crypto";
import OpenAI from "openai";
import { config } from "../config.js";
import { traceEvents } from "../events/event-bus.js";
import { AGENT_INSTRUCTIONS } from "./prompt.js";
import { executeTool, toolDefinitions } from "./tools.js";

const MAX_TOOL_ROUNDS = 6;

export interface AgentResult {
  runId: string;
  output: string;
  model: string;
  mode: "openai" | "mock";
  rounds: number;
}

export async function runAgent(brief: string, requestedRunId?: string): Promise<AgentResult> {
  const runId = requestedRunId ?? randomUUID();
  if (config.mockMode) {
    return runMockAgent(brief, runId);
  }

  const client = new OpenAI({ apiKey: config.apiKey });
  const input: OpenAI.Responses.ResponseInput = [{ role: "user", content: brief }];

  traceEvents.emit(runId, "status", {
    state: "started",
    model: config.model,
    reasoning_effort: config.reasoningEffort,
  });

  for (let round = 1; round <= MAX_TOOL_ROUNDS; round += 1) {
    const response = await client.responses.create({
      model: config.model,
      instructions: AGENT_INSTRUCTIONS,
      input,
      tools: toolDefinitions,
      reasoning: { effort: config.reasoningEffort },
      text: { verbosity: "low" },
      store: false,
    });

    // The Responses API accepts prior output items as continuation input. The SDK's
    // broad ResponseOutputItem union also includes hosted-tool variants that make
    // the otherwise documented continuation pattern too wide for TypeScript.
    input.push(...(response.output as unknown as OpenAI.Responses.ResponseInputItem[]));
    const calls = response.output.filter((item) => item.type === "function_call");

    if (calls.length === 0) {
      traceEvents.emit(runId, "status", { state: "completed", round });
      return {
        runId,
        output: response.output_text,
        model: config.model,
        mode: "openai",
        rounds: round,
      };
    }

    for (const call of calls) {
      // The payload is the unmodified SDK function_call item shown on the trace screen.
      traceEvents.emit(runId, "tool_call", call);
      const output = await executeTool(call.name, call.arguments);
      const resultItem = {
        type: "function_call_output" as const,
        call_id: call.call_id,
        output,
      };
      // This is the exact function_call_output item sent back to the Responses API.
      traceEvents.emit(runId, "tool_result", resultItem);
      input.push(resultItem);
    }
  }

  throw new Error(`Agent exceeded the ${MAX_TOOL_ROUNDS}-round safety limit.`);
}

async function runMockAgent(brief: string, runId: string): Promise<AgentResult> {
  traceEvents.emit(runId, "status", { state: "started", mode: "mock" });

  const mockCall = {
    type: "function_call",
    call_id: `mock_${randomUUID()}`,
    name: "analyze_brief",
    arguments: JSON.stringify({
      objective: brief.slice(0, 160),
      audience: "demo audience",
      deliverable: "creative response",
      constraints: ["Mock mode: set OPENAI_API_KEY for real model behavior"],
    }),
  };
  traceEvents.emit(runId, "tool_call", mockCall);
  const output = await executeTool(mockCall.name, mockCall.arguments);
  traceEvents.emit(runId, "tool_result", {
    type: "function_call_output",
    call_id: mockCall.call_id,
    output,
  });
  traceEvents.emit(runId, "status", { state: "completed", mode: "mock" });

  return {
    runId,
    output:
      "모의 실행이 완료되었습니다. 원본 도구 이벤트는 세컨드 화면에 표시되었습니다. 실제 결과를 생성하려면 .env에 OPENAI_API_KEY를 설정하세요.",
    model: config.model,
    mode: "mock",
    rounds: 1,
  };
}
