import { createHash, randomUUID } from "node:crypto";
import { copyFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { config } from "../config.js";
import { traceEvents } from "../events/event-bus.js";
import type { VisualSystemSpec } from "../team/contracts.js";
import { inspectImage, readLimitedImageBody } from "./binary.js";
import type { ImageCandidate, ImageIntent, ImageResolutionResult, SelectedImage } from "./contracts.js";
import { selectedImageSchema } from "./contracts.js";
import { imageQuotaLedger } from "./quota-ledger.js";
import { ImageProviderError, searchPexels, searchUnsplash, trackUnsplashSelection } from "./providers.js";
import { uploadRegistry } from "./upload-registry.js";

export interface ResolveImagesInput {
  runId: string;
  visualSystem: VisualSystemSpec;
  uploadedAssetIds: string[];
  officialImageUrls: string[];
  fetchImpl?: typeof fetch;
  // Image-repair pass: restrict resolution to the critic-flagged slides and
  // never re-pick the assets the critic rejected.
  onlySlideIds?: string[];
  excludeAssetIds?: string[];
}

function allowedOfficialUrl(value: string): URL | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return null;
    const host = url.hostname.toLocaleLowerCase();
    const allowed = config.officialImageAllowedHosts.some((entry) => host === entry || host.endsWith(`.${entry}`));
    return allowed ? url : null;
  } catch {
    return null;
  }
}

function publicCandidate(candidate: ImageCandidate): Record<string, unknown> {
  return {
    assetId: candidate.assetId,
    provider: candidate.provider,
    previewUrl: candidate.previewUrl,
    sourcePageUrl: candidate.sourcePageUrl,
    attributionText: candidate.attributionText,
    creatorName: candidate.creatorName,
    creatorUrl: candidate.creatorUrl,
    width: candidate.width,
    height: candidate.height,
  };
}

function traceCall(runId: string, payload: Record<string, unknown>): void {
  traceEvents.emit(runId, "tool_call", payload);
}

function traceResult(runId: string, payload: Record<string, unknown>): void {
  traceEvents.emit(runId, "tool_result", payload);
}

async function fetchOfficialWithAllowlist(url: URL, fetchImpl: typeof fetch): Promise<Response> {
  let current = url;
  for (let redirects = 0; redirects <= 3; redirects += 1) {
    const response = await fetchImpl(current, { redirect: "manual", signal: AbortSignal.timeout(config.imageDownloadTimeoutMs) });
    if (![301, 302, 303, 307, 308].includes(response.status)) return response;
    const location = response.headers.get("location");
    if (!location) throw new Error("Official image redirect has no location header.");
    const next = allowedOfficialUrl(new URL(location, current).toString());
    if (!next) throw new Error("Official image redirected outside OFFICIAL_IMAGE_ALLOWED_HOSTS.");
    current = next;
  }
  throw new Error("Official image exceeded the redirect limit.");
}

async function fetchStockWithAllowlist(candidate: ImageCandidate, fetchImpl: typeof fetch): Promise<Response> {
  if (!candidate.downloadUrl || !["pexels", "unsplash"].includes(candidate.provider)) {
    throw new Error("Stock candidate has no trusted download URL.");
  }
  const allowedHosts = candidate.provider === "pexels" ? ["images.pexels.com"] : ["images.unsplash.com"];
  let current = new URL(candidate.downloadUrl);
  for (let redirects = 0; redirects <= 3; redirects += 1) {
    const host = current.hostname.toLocaleLowerCase();
    if (current.protocol !== "https:" || !allowedHosts.some((allowed) => host === allowed || host.endsWith(`.${allowed}`))) {
      throw new Error(`${candidate.provider} image URL left its trusted CDN.`);
    }
    const response = await fetchImpl(current, { redirect: "manual", signal: AbortSignal.timeout(config.imageDownloadTimeoutMs) });
    if (![301, 302, 303, 307, 308].includes(response.status)) return response;
    const location = response.headers.get("location");
    if (!location) throw new Error(`${candidate.provider} image redirect has no location header.`);
    current = new URL(location, current);
  }
  throw new Error(`${candidate.provider} image exceeded the redirect limit.`);
}

function safeFilePart(value: string): string {
  return value.normalize("NFKC").replace(/[^A-Za-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 32) || "slide";
}

async function materializeCandidate(
  runId: string,
  slideId: string,
  candidate: ImageCandidate,
  fetchImpl: typeof fetch,
): Promise<SelectedImage> {
  traceCall(runId, { type: "image_download", slideId, candidate: publicCandidate(candidate) });
  let buffer: Buffer;
  if (candidate.localSourcePath) {
    const uploaded = uploadRegistry.get(candidate.providerAssetId);
    if (!uploaded || uploaded.localPath !== candidate.localSourcePath) throw new Error("Uploaded image is no longer registered in this server process.");
    buffer = await import("node:fs/promises").then(({ readFile }) => readFile(uploaded.localPath));
  } else {
    if (!candidate.downloadUrl) throw new Error("Selected image has no download URL.");
    if (candidate.provider === "unsplash") {
      await trackUnsplashSelection(candidate, {
        apiKey: config.unsplashAccessKey || "",
        maxCandidates: config.imageCandidatesPerSlide,
        dailyBudget: config.unsplashDailyCallBudget,
        stopRatio: config.imageQuotaStopRatio,
        ledger: imageQuotaLedger,
        fetchImpl,
      });
    }
    const response = candidate.provider === "official"
      ? await fetchOfficialWithAllowlist(new URL(candidate.downloadUrl), fetchImpl)
      : await fetchStockWithAllowlist(candidate, fetchImpl);
    if (!response.ok) throw new Error(`${candidate.provider} image download failed with HTTP ${response.status}.`);
    buffer = await readLimitedImageBody(response, config.imageMaxDownloadBytes);
  }
  if (buffer.byteLength > config.imageMaxDownloadBytes) throw new Error(`Image exceeds the ${config.imageMaxDownloadBytes}-byte limit.`);
  const inspected = inspectImage(buffer);
  const directory = path.resolve("artifacts", "images");
  await mkdir(directory, { recursive: true });
  const filename = `${safeFilePart(runId.slice(0, 12))}-${safeFilePart(slideId)}-${randomUUID().slice(0, 8)}.${inspected.extension}`;
  const target = path.join(directory, filename);
  if (candidate.localSourcePath) await copyFile(candidate.localSourcePath, target);
  else await writeFile(target, buffer);
  const selected = selectedImageSchema.parse({
    slideId,
    assetId: candidate.assetId,
    provider: candidate.provider,
    localRelativePath: `images/${filename}`,
    previewUrl: `/api/images/${encodeURIComponent(filename)}`,
    sourcePageUrl: candidate.sourcePageUrl,
    attributionText: candidate.attributionText,
    creatorName: candidate.creatorName,
    creatorUrl: candidate.creatorUrl,
    width: inspected.width,
    height: inspected.height,
    mimeType: inspected.mimeType,
    sha256: createHash("sha256").update(buffer).digest("hex"),
  });
  traceResult(runId, { type: "image_download_result", slideId, selected });
  return selected;
}

function uploadCandidates(assetIds: string[]): ImageCandidate[] {
  return assetIds.flatMap((assetId) => {
    const asset = uploadRegistry.get(assetId);
    if (!asset) return [];
    return [{
      assetId: `upload:${asset.assetId}`,
      provider: "user_upload" as const,
      providerAssetId: asset.assetId,
      previewUrl: "local-only",
      downloadUrl: null,
      downloadLocation: null,
      sourcePageUrl: null,
      attributionText: `Provided by user · ${asset.boardLabel}`,
      creatorName: null,
      creatorUrl: null,
      width: asset.width,
      height: asset.height,
      localSourcePath: asset.localPath,
    }];
  });
}

function officialCandidates(urls: string[]): ImageCandidate[] {
  if (!config.officialImagesEnabled) return [];
  return urls.flatMap((value, index) => {
    const url = allowedOfficialUrl(value);
    if (!url) return [];
    return [{
      assetId: `official:${createHash("sha256").update(url.toString()).digest("hex").slice(0, 20)}`,
      provider: "official" as const,
      providerAssetId: String(index),
      previewUrl: url.toString(),
      downloadUrl: url.toString(),
      downloadLocation: null,
      sourcePageUrl: url.toString(),
      attributionText: `Official image · ${url.hostname}`,
      creatorName: null,
      creatorUrl: null,
      width: 1,
      height: 1,
      localSourcePath: null,
    }];
  });
}

function sourceOrder(intent: ImageIntent): Array<"user_upload" | "official" | "stock"> {
  if (intent.preferredSource === "user_upload") return ["user_upload", "official", "stock"];
  if (intent.preferredSource === "official") return ["official", "user_upload", "stock"];
  if (intent.preferredSource === "stock") return ["stock", "user_upload", "official"];
  return ["user_upload", "official", "stock"];
}

function sourceBucket(candidate: ImageCandidate): "user_upload" | "official" | "stock" {
  return candidate.provider === "pexels" || candidate.provider === "unsplash" ? "stock" : candidate.provider;
}

function orientationScore(candidate: ImageCandidate, intent: ImageIntent): number {
  if (candidate.width <= 1 || candidate.height <= 1) return 0;
  const ratio = candidate.width / candidate.height;
  if (intent.orientation === "landscape") return ratio >= 1.35 ? 20 : ratio >= 1 ? 10 : -12;
  if (intent.orientation === "portrait") return ratio <= 0.8 ? 20 : ratio <= 1 ? 10 : -12;
  const distance = Math.abs(1 - ratio);
  return distance <= 0.12 ? 20 : distance <= 0.3 ? 10 : -8;
}

function resolutionScore(candidate: ImageCandidate): number {
  const pixels = candidate.width * candidate.height;
  if (pixels >= 4_000_000) return 15;
  if (pixels >= 2_000_000) return 10;
  if (pixels >= 1_000_000) return 6;
  return 0;
}

function sourcePreferenceScore(candidate: ImageCandidate, intent: ImageIntent): number {
  const bucket = sourceBucket(candidate);
  if (intent.preferredSource === "auto") return bucket === "user_upload" ? 36 : bucket === "official" ? 32 : 24;
  if (bucket === intent.preferredSource) return 50;
  return bucket === "stock" ? 14 : 20;
}

export interface RankedImageCandidate {
  candidate: ImageCandidate;
  score: number;
  reasons: string[];
}

export function rankImageCandidates(
  candidates: ImageCandidate[],
  intent: ImageIntent,
  usedAssetIds: Set<string>,
  usedProviders: Set<ImageCandidate["provider"]>,
): RankedImageCandidate[] {
  return candidates
    .filter((candidate) => !usedAssetIds.has(candidate.assetId))
    .map((candidate, index) => {
      const source = sourcePreferenceScore(candidate, intent);
      const orientation = orientationScore(candidate, intent);
      const resolution = resolutionScore(candidate);
      const providerDiversity = usedProviders.has(candidate.provider) ? 0 : 10;
      const searchRank = Math.max(0, 6 - index);
      return {
        candidate,
        score: source + orientation + resolution + providerDiversity + searchRank,
        reasons: [
          `source:${source}`,
          `orientation:${orientation}`,
          `resolution:${resolution}`,
          `provider_diversity:${providerDiversity}`,
          `rank:${searchRank}`,
        ],
      };
    })
    .sort((a, b) => b.score - a.score || a.candidate.assetId.localeCompare(b.candidate.assetId));
}

export async function resolveImagesForDeck(input: ResolveImagesInput): Promise<ImageResolutionResult> {
  const selected: SelectedImage[] = [];
  const warnings: string[] = [];
  const uploads = uploadCandidates(input.uploadedAssetIds);
  const official = officialCandidates(input.officialImageUrls);
  const used = new Set<string>(input.excludeAssetIds ?? []);
  const usedProviders = new Set<ImageCandidate["provider"]>();
  const fetchImpl = input.fetchImpl ?? fetch;
  let searchCalls = 0;

  for (const [index, directive] of input.visualSystem.slideDirectives.entries()) {
    if (selected.length >= config.imageMaxPerDeck) break;
    if (input.onlySlideIds && !input.onlySlideIds.includes(directive.slideId)) continue;
    if (directive.imageNeed === "none") continue;
    if (!directive.imageIntent) {
      warnings.push(`${directive.slideId}: imageNeed=${directive.imageNeed} but imageIntent is missing.`);
      continue;
    }
    const candidatePool: ImageCandidate[] = [];
    const sources = directive.visualAssetType === "screenshot"
      ? ["user_upload", "official"] as const
      : sourceOrder(directive.imageIntent);
    for (const source of sources) {
      if (source === "user_upload") candidatePool.push(...uploads.filter((candidate) => !used.has(candidate.assetId)));
      if (source === "official") candidatePool.push(...official.filter((candidate) => !used.has(candidate.assetId)));
      if (source === "stock" && config.imageSearchEnabled && searchCalls < config.imageMaxSearchCallsPerDeck) {
        const providers = index % 2 === 0 ? ["pexels", "unsplash"] as const : ["unsplash", "pexels"] as const;
        for (const provider of providers) {
          const enabled = provider === "pexels" ? config.pexelsEnabled : config.unsplashEnabled;
          if (!enabled || searchCalls >= config.imageMaxSearchCallsPerDeck) continue;
          const searchInput = { type: "image_search", provider, slideId: directive.slideId, intent: directive.imageIntent, maxCandidates: config.imageCandidatesPerSlide };
          traceCall(input.runId, searchInput);
          searchCalls += 1;
          try {
            const result = provider === "pexels"
              ? await searchPexels(directive.imageIntent, {
                apiKey: config.pexelsApiKey || "", maxCandidates: config.imageCandidatesPerSlide,
                dailyBudget: config.pexelsDailyCallBudget, stopRatio: config.imageQuotaStopRatio,
                ledger: imageQuotaLedger, fetchImpl,
              })
              : await searchUnsplash(directive.imageIntent, {
                apiKey: config.unsplashAccessKey || "", maxCandidates: config.imageCandidatesPerSlide,
                dailyBudget: config.unsplashDailyCallBudget, stopRatio: config.imageQuotaStopRatio,
                ledger: imageQuotaLedger, fetchImpl,
              });
            traceResult(input.runId, { type: "image_search_result", ...result });
            candidatePool.push(...result.candidates);
            if (!result.quota.allowed) warnings.push(`${directive.slideId}: ${provider} stopped (${result.quota.reason}).`);
          } catch (error) {
            const message = error instanceof Error ? error.message : "Unknown image search error";
            traceResult(input.runId, { type: "image_search_result", provider, slideId: directive.slideId, error: message, retry: false });
            warnings.push(`${directive.slideId}: ${message}`);
            if (error instanceof ImageProviderError && error.status === 429) continue;
          }
        }
      }
    }
    const ranked = rankImageCandidates(
      [...new Map(candidatePool.map((candidate) => [candidate.assetId, candidate])).values()],
      directive.imageIntent,
      used,
      usedProviders,
    );
    const chosen = ranked[0]?.candidate ?? null;
    traceResult(input.runId, {
      type: "image_candidate_selection",
      slideId: directive.slideId,
      intent: directive.imageIntent,
      candidates: ranked.map((entry) => ({ ...publicCandidate(entry.candidate), score: entry.score, reasons: entry.reasons })),
      selectedAssetId: chosen?.assetId ?? null,
    });
    if (!chosen) {
      warnings.push(`${directive.slideId}: no eligible image candidate was available.`);
      continue;
    }
    try {
      const asset = await materializeCandidate(input.runId, directive.slideId, chosen, fetchImpl);
      used.add(chosen.assetId);
      usedProviders.add(chosen.provider);
      selected.push(asset);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown image download error";
      traceResult(input.runId, { type: "image_download_result", slideId: directive.slideId, error: message, retry: false });
      warnings.push(`${directive.slideId}: ${message}`);
    }
  }

  traceEvents.emit(input.runId, "status", {
    state: "image_retrieval_complete",
    selected_count: selected.length,
    search_calls: searchCalls,
    limits: { per_slide_candidates: config.imageCandidatesPerSlide, per_deck_images: config.imageMaxPerDeck },
    quota: imageQuotaLedger.snapshot(),
    warnings,
  });
  return { selected, warnings, searchCalls };
}
