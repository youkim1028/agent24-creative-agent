import express from "express";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { config } from "./config.js";
import { runAgent } from "./agent/runner.js";
import { traceEvents } from "./events/event-bus.js";

const app = express();
const requestSchema = z.object({ brief: z.string().trim().min(3).max(8_000) });

app.disable("x-powered-by");
app.use(express.json({ limit: "100kb" }));
app.use(express.static(path.resolve("public")));

app.get("/api/health", (_request, response) => {
  response.json({
    ok: true,
    mode: config.mockMode ? "mock" : "openai",
    model: config.model,
    reasoningEffort: config.reasoningEffort,
  });
});

app.post("/api/run", async (request, response) => {
  const parsed = requestSchema.safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({ error: "Brief must contain between 3 and 8,000 characters." });
    return;
  }

  const runId = randomUUID();
  try {
    const result = await runAgent(parsed.data.brief, runId);
    response.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown agent failure";
    traceEvents.emit(runId, "error", { message });
    response.status(500).json({ error: message, runId });
  }
});

app.get("/api/events", (request, response) => {
  response.setHeader("Content-Type", "text/event-stream");
  response.setHeader("Cache-Control", "no-cache");
  response.setHeader("Connection", "keep-alive");
  response.flushHeaders();

  for (const event of traceEvents.getHistory()) {
    response.write(`id: ${event.id}\ndata: ${JSON.stringify(event)}\n\n`);
  }

  const unsubscribe = traceEvents.subscribe((event) => {
    response.write(`id: ${event.id}\ndata: ${JSON.stringify(event)}\n\n`);
  });
  const heartbeat = setInterval(() => response.write(": heartbeat\n\n"), 15_000);

  request.on("close", () => {
    clearInterval(heartbeat);
    unsubscribe();
  });
});

app.delete("/api/events", (_request, response) => {
  traceEvents.clear();
  response.status(204).end();
});

app.listen(config.port, () => {
  const mode = config.mockMode ? "MOCK (add OPENAI_API_KEY to .env)" : "OPENAI";
  console.log(`Agent24 running at http://localhost:${config.port} [${mode}]`);
  console.log(`Raw event screen: http://localhost:${config.port}/trace.html`);
});

