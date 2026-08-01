import express from "express";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { config } from "./config.js";
import { runAgent } from "./agent/runner.js";
import { traceEvents } from "./events/event-bus.js";

const app = express();
const requestSchema = z.object({
  brief: z.string().trim().min(3).max(8_000),
  slideCount: z.number().int().min(3).max(5).default(5),
  language: z.enum(["ko", "en"]).default("ko"),
  purpose: z.string().trim().max(240).default("Create a clear, decision-ready presentation."),
  audience: z.string().trim().max(160).default("General decision-makers"),
  presentationContext: z.string().trim().max(240).default("Live presentation"),
  userVoice: z.string().trim().max(240).default("Clear, direct, and grounded"),
  visualPreference: z.string().trim().max(240).default("Use the topic's own visual language."),
  targetMarkets: z.array(z.string().trim().min(1).max(60)).max(3).default([]),
  fromDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().default(null),
  toDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().default(null),
  allowedHandles: z.array(z.string().min(1).max(80)).max(20).default([]),
});

app.disable("x-powered-by");
app.use(express.json({ limit: "100kb" }));
app.use(express.static(path.resolve("public")));

app.get("/api/health", (_request, response) => {
  response.json({
    ok: true,
    openai: {
      mode: config.mockOpenAI ? "mock" : "openai",
      model: config.qualityModel,
      teamModels: {
        fast: config.fastModel,
        quality: config.qualityModel,
        critic: config.criticModel,
      },
    },
    xai: { mode: config.mockXai ? "mock" : "xai", model: config.grokModel },
    reasoningEffort: config.reasoningEffort,
    architecture: config.agentArchitecture,
    tokenLimits: {
      openaiMaxOutputTokens: config.openaiMaxOutputTokens,
      grokMaxOutputTokens: config.grokMaxOutputTokens,
      runBudgetTokens: config.agentMaxTotalTokens,
      xMaxPosts: config.xMaxPosts,
    },
    memory: { mode: config.gcsMemoryEnabled ? "gcs" : "disabled" },
    reddit: { mode: config.redditEnabled ? "public-search" : "disabled", maxPosts: config.redditMaxPosts },
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
    const result = await runAgent(parsed.data, runId);
    response.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown agent failure";
    traceEvents.emit(runId, "error", { message });
    response.status(500).json({ error: message, runId });
  }
});

app.get("/api/artifacts/:filename", (request, response) => {
  const filename = path.basename(request.params.filename);
  if (!/\.(?:pptx|json)$/i.test(filename)) {
    response.status(400).json({ error: "Unsupported artifact type." });
    return;
  }
  response.sendFile(path.resolve("artifacts", filename), (error) => {
    if (error && !response.headersSent) response.status(404).json({ error: "Artifact not found." });
  });
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
  const openaiMode = config.mockOpenAI ? "MOCK GPT" : "OPENAI";
  const xaiMode = config.mockXai ? "MOCK X" : "XAI";
  console.log(`DeckForge X running at http://localhost:${config.port} [${openaiMode} / ${xaiMode}]`);
  console.log(`Raw event screen: http://localhost:${config.port}/trace.html`);
});

