import type { ImageCandidate, ImageIntent, ImageProvider } from "./contracts.js";
import { ImageQuotaLedger } from "./quota-ledger.js";

interface ProviderOptions {
  apiKey: string;
  maxCandidates: number;
  dailyBudget: number;
  stopRatio: number;
  ledger: ImageQuotaLedger;
  fetchImpl?: typeof fetch;
}

export interface ImageSearchResult {
  provider: Extract<ImageProvider, "pexels" | "unsplash">;
  candidates: ImageCandidate[];
  quota: { allowed: boolean; reason: string | null };
}

export class ImageProviderError extends Error {
  constructor(
    public readonly provider: "pexels" | "unsplash",
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

function boundedText(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function trustedHttps(value: unknown, allowedHosts: string[]): string {
  const text = boundedText(value, 2000);
  try {
    const url = new URL(text);
    if (url.protocol !== "https:") return "";
    const host = url.hostname.toLocaleLowerCase();
    return allowedHosts.some((allowed) => host === allowed || host.endsWith(`.${allowed}`)) ? url.toString() : "";
  } catch {
    return "";
  }
}

function orientationForProvider(orientation: ImageIntent["orientation"]): string {
  return orientation === "square" ? "squarish" : orientation;
}

export async function searchPexels(intent: ImageIntent, options: ProviderOptions): Promise<ImageSearchResult> {
  const decision = options.ledger.canCall("pexels", options.dailyBudget, options.stopRatio);
  if (!decision.allowed) return { provider: "pexels", candidates: [], quota: decision };
  options.ledger.recordAttempt("pexels");
  const url = new URL("https://api.pexels.com/v1/search");
  url.searchParams.set("query", intent.query);
  url.searchParams.set("orientation", intent.orientation === "square" ? "square" : intent.orientation);
  url.searchParams.set("per_page", String(options.maxCandidates));
  const response = await (options.fetchImpl ?? fetch)(url, {
    headers: { Authorization: options.apiKey },
    signal: AbortSignal.timeout(10_000),
  });
  options.ledger.recordResponse("pexels", response.status, response.headers);
  if (!response.ok) throw new ImageProviderError("pexels", response.status, `Pexels search failed with HTTP ${response.status}.`);
  const body = await response.json() as { photos?: unknown[] };
  const candidates = (Array.isArray(body.photos) ? body.photos : []).slice(0, options.maxCandidates).flatMap((value) => {
    const photo = value as Record<string, any>;
    const id = String(photo.id ?? "");
    const downloadUrl = trustedHttps(photo.src?.large2x || photo.src?.large || photo.src?.original, ["images.pexels.com"]);
    const sourcePageUrl = trustedHttps(photo.url, ["pexels.com"]);
    const creatorName = boundedText(photo.photographer, 100);
    const creatorUrl = trustedHttps(photo.photographer_url, ["pexels.com"]);
    if (!id || !downloadUrl || !sourcePageUrl || !Number.isFinite(photo.width) || !Number.isFinite(photo.height)) return [];
    return [{
      assetId: `pexels:${id}`,
      provider: "pexels" as const,
      providerAssetId: id,
      previewUrl: trustedHttps(photo.src?.medium || downloadUrl, ["images.pexels.com"]),
      downloadUrl,
      downloadLocation: null,
      sourcePageUrl,
      attributionText: `Photo by ${creatorName || "a Pexels contributor"} on Pexels`,
      creatorName: creatorName || null,
      creatorUrl: creatorUrl || null,
      width: Math.round(photo.width),
      height: Math.round(photo.height),
      localSourcePath: null,
    }];
  });
  return { provider: "pexels", candidates, quota: { allowed: true, reason: null } };
}

export async function searchUnsplash(intent: ImageIntent, options: ProviderOptions): Promise<ImageSearchResult> {
  const decision = options.ledger.canCall("unsplash", options.dailyBudget, options.stopRatio);
  if (!decision.allowed) return { provider: "unsplash", candidates: [], quota: decision };
  options.ledger.recordAttempt("unsplash");
  const url = new URL("https://api.unsplash.com/search/photos");
  url.searchParams.set("query", intent.query);
  url.searchParams.set("orientation", orientationForProvider(intent.orientation));
  url.searchParams.set("per_page", String(options.maxCandidates));
  const response = await (options.fetchImpl ?? fetch)(url, {
    headers: { Authorization: `Client-ID ${options.apiKey}`, "Accept-Version": "v1" },
    signal: AbortSignal.timeout(10_000),
  });
  options.ledger.recordResponse("unsplash", response.status, response.headers);
  if (!response.ok) throw new ImageProviderError("unsplash", response.status, `Unsplash search failed with HTTP ${response.status}.`);
  const body = await response.json() as { results?: unknown[] };
  const candidates = (Array.isArray(body.results) ? body.results : []).slice(0, options.maxCandidates).flatMap((value) => {
    const photo = value as Record<string, any>;
    const id = boundedText(photo.id, 100);
    const downloadUrl = trustedHttps(photo.urls?.regular, ["images.unsplash.com"]);
    const downloadLocation = trustedHttps(photo.links?.download_location, ["api.unsplash.com"]);
    const sourcePageUrl = trustedHttps(photo.links?.html, ["unsplash.com"]);
    const creatorName = boundedText(photo.user?.name, 100);
    const creatorUrl = trustedHttps(photo.user?.links?.html, ["unsplash.com"]);
    if (!id || !downloadUrl || !downloadLocation || !sourcePageUrl || !Number.isFinite(photo.width) || !Number.isFinite(photo.height)) return [];
    return [{
      assetId: `unsplash:${id}`,
      provider: "unsplash" as const,
      providerAssetId: id,
      previewUrl: trustedHttps(photo.urls?.small || downloadUrl, ["images.unsplash.com"]),
      downloadUrl,
      downloadLocation,
      sourcePageUrl,
      attributionText: `Photo by ${creatorName || "an Unsplash contributor"} on Unsplash`,
      creatorName: creatorName || null,
      creatorUrl: creatorUrl || null,
      width: Math.round(photo.width),
      height: Math.round(photo.height),
      localSourcePath: null,
    }];
  });
  return { provider: "unsplash", candidates, quota: { allowed: true, reason: null } };
}

export async function trackUnsplashSelection(candidate: ImageCandidate, options: ProviderOptions): Promise<void> {
  if (!candidate.downloadLocation) throw new Error("Unsplash candidate is missing download_location.");
  const decision = options.ledger.canCall("unsplash", options.dailyBudget, options.stopRatio);
  if (!decision.allowed) throw new Error(`Unsplash download tracking stopped: ${decision.reason}.`);
  options.ledger.recordAttempt("unsplash");
  const response = await (options.fetchImpl ?? fetch)(candidate.downloadLocation, {
    headers: { Authorization: `Client-ID ${options.apiKey}`, "Accept-Version": "v1" },
    signal: AbortSignal.timeout(10_000),
  });
  options.ledger.recordResponse("unsplash", response.status, response.headers);
  if (!response.ok) throw new ImageProviderError("unsplash", response.status, `Unsplash download tracking failed with HTTP ${response.status}.`);
}
