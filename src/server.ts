import express from "express";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { config } from "./config.js";
import { runAgent } from "./agent/runner.js";
import { traceEvents } from "./events/event-bus.js";
import { imageQuotaLedger } from "./images/quota-ledger.js";
import { uploadRegistry } from "./images/upload-registry.js";
import { youtubeQuotaLedger } from "./providers/youtube-quota.js";
import { extractPptxOutline, pptxOutlineToBrief } from "./deck/pptx-import.js";

const app = express();
const isoDateSchema = z.string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const parsed = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
  }, "Date must be a real YYYY-MM-DD value.");

const requestSchema = z.object({
  brief: z.string().trim().min(3).max(8_000),
  slideCount: z.number().int().min(3).max(5).default(5),
  language: z.enum(["ko", "en"]).default("ko"),
  additionalContext: z.string().trim().max(1_000).default(""),
  // Kept for API compatibility. Empty values are intentionally not replaced with
  // generic defaults: the Research Planner resolves all five fields from the brief.
  purpose: z.string().trim().max(240).default(""),
  audience: z.string().trim().max(160).default(""),
  presentationContext: z.string().trim().max(240).default(""),
  userVoice: z.string().trim().max(240).default(""),
  visualPreference: z.string().trim().max(240).default(""),
  targetMarkets: z.array(z.string().trim().min(1).max(60)).max(3).default([]),
  fromDate: isoDateSchema.nullable().default(null),
  toDate: isoDateSchema.nullable().default(null),
  allowedHandles: z.array(z.string().min(1).max(80)).max(20).default([]),
  uploadedAssetIds: z.array(z.string().uuid()).max(8).default([]),
  officialImageUrls: z.array(z.string().url().max(2000)).max(8).default([]),
  designReferenceUrls: z.array(z.string().url().max(2000)).max(8).default([]),
}).superRefine((value, context) => {
  if (value.fromDate && value.toDate && value.fromDate > value.toDate) {
    context.addIssue({ code: "custom", path: ["toDate"], message: "toDate must be on or after fromDate." });
  }
});

app.disable("x-powered-by");
app.use(express.json({ limit: "100kb" }));
app.use(express.static(path.resolve("public")));

app.get("/api/health", (_request, response) => {
  response.json({
    ok: true,
    openai: {
      mode: config.mockOpenAI ? "mock" : "openai",
      model: config.criticalModel,
      teamModels: {
        fast: config.fastModel,
        critical: config.criticalModel,
        critic: config.criticModel,
      },
      execution: {
        fast: { reasoningEffort: config.reasoningEffort, serviceTier: config.serviceTier },
        standard: { reasoningEffort: config.standardReasoningEffort, serviceTier: config.criticalServiceTier },
        deep: { reasoningEffort: config.criticalReasoningEffort, serviceTier: config.criticalServiceTier },
      },
    },
    xai: { mode: config.mockXai ? "mock" : "xai", model: config.grokModel },
    reasoningEffort: config.reasoningEffort,
    architecture: config.agentArchitecture,
    tokenLimits: {
      openaiMaxOutputTokens: config.openaiMaxOutputTokens,
      teamRoleOutputTokens: config.teamRoleTokenLimits,
      grokMaxOutputTokens: config.grokMaxOutputTokens,
      runBudgetTokens: config.agentMaxTotalTokens,
      xMaxPosts: config.xMaxPosts,
      xSearchCandidates: config.xSearchCandidates,
      youtubeMaxPosts: config.youtubeMaxPosts,
      youtubeVideoCandidates: config.youtubeVideoCandidates,
      youtubeCommentsPerVideo: config.youtubeCommentsPerVideo,
      hackerNewsMaxPosts: config.hackerNewsMaxPosts,
      hackerNewsSearchCandidates: config.hackerNewsSearchCandidates,
    },
    memory: { mode: config.gcsMemoryEnabled ? "gcs" : "disabled" },
    youtube: {
      mode: config.youtubeEnabled ? "live" : "disabled",
      maxPosts: config.youtubeMaxPosts,
      dailyCallBudget: config.youtubeDailyCallBudget,
      quotaStopRatio: config.youtubeQuotaStopRatio,
      quota: youtubeQuotaLedger.snapshot(),
    },
    hackerNews: {
      mode: config.hackerNewsEnabled ? "live" : "disabled",
      maxPosts: config.hackerNewsMaxPosts,
      searchCandidates: config.hackerNewsSearchCandidates,
    },
    images: {
      visualAssetTypes: ["none", "photo", "screenshot", "chart", "diagram"],
      nativePowerPoint: { charts: true, diagrams: true },
      maxPerDeck: config.imageMaxPerDeck,
      candidatesPerSlide: config.imageCandidatesPerSlide,
      quotaStopRatio: config.imageQuotaStopRatio,
      providers: {
        pexels: { mode: config.pexelsEnabled ? "live" : "disabled" },
        unsplash: { mode: config.unsplashEnabled ? "live" : "disabled" },
        official: { mode: config.officialImagesEnabled ? "allowlisted" : "disabled" },
        userUploads: { mode: config.userUploadsEnabled ? "local" : "disabled" },
        dribbble: { mode: config.dribbbleReferencesEnabled ? "reference-links" : "disabled" },
      },
      quota: imageQuotaLedger.snapshot(),
    },
  });
});

app.post(
  "/api/uploads",
  express.raw({ type: ["image/jpeg", "image/png", "image/webp"], limit: config.imageMaxDownloadBytes }),
  async (request, response) => {
    if (!config.userUploadsEnabled) {
      response.status(403).json({ error: "User image uploads are disabled." });
      return;
    }
    if (!Buffer.isBuffer(request.body) || request.body.length === 0) {
      response.status(400).json({ error: "Upload a JPEG, PNG, or WebP binary body." });
      return;
    }
    try {
      const filename = typeof request.headers["x-file-name"] === "string" ? request.headers["x-file-name"] : "upload";
      const boardLabel = typeof request.headers["x-board-label"] === "string" ? request.headers["x-board-label"] : "User reference board";
      const asset = await uploadRegistry.register(request.body, decodeURIComponent(filename), decodeURIComponent(boardLabel));
      response.status(201).json(asset);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Invalid image upload.";
      response.status(400).json({ error: message });
    }
  },
);

// Revision entry point: an existing PPTX is reduced to a text outline that the
// client folds into the brief, so the same team pipeline redesigns the deck.
app.post(
  "/api/uploads/pptx",
  express.raw({
    type: ["application/vnd.openxmlformats-officedocument.presentationml.presentation", "application/octet-stream"],
    limit: "15mb",
  }),
  async (request, response) => {
    if (!Buffer.isBuffer(request.body) || request.body.length === 0) {
      response.status(400).json({ error: ".pptx 파일 본문을 업로드하세요." });
      return;
    }
    try {
      const filename = typeof request.headers["x-file-name"] === "string"
        ? decodeURIComponent(request.headers["x-file-name"])
        : "presentation.pptx";
      const outline = await extractPptxOutline(request.body);
      response.json({ slideCount: outline.slideCount, brief: pptxOutlineToBrief(outline, filename) });
    } catch (error) {
      const message = error instanceof Error ? error.message : "PPTX를 해석하지 못했습니다.";
      response.status(400).json({ error: message });
    }
  },
);

app.post("/api/run", async (request, response) => {
  const parsed = requestSchema.safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({ error: "Invalid run request.", issues: parsed.error.flatten().fieldErrors });
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
  } finally {
    await uploadRegistry.releaseMany(parsed.data.uploadedAssetIds);
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

app.get("/api/images/:filename", (request, response) => {
  const filename = path.basename(request.params.filename);
  if (!/^[A-Za-z0-9._-]+\.(?:jpe?g|png|webp)$/i.test(filename)) {
    response.status(400).json({ error: "Unsupported image filename." });
    return;
  }
  response.sendFile(path.resolve("artifacts", "images", filename), (error) => {
    if (error && !response.headersSent) response.status(404).json({ error: "Image not found." });
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
