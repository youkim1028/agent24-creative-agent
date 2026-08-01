import { unlink } from "node:fs/promises";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/config.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/config.js")>();
  return {
    config: {
      ...actual.config,
      imageSearchEnabled: true,
      pexelsEnabled: true,
      pexelsApiKey: "test-pexels-key",
      pexelsDailyCallBudget: 100,
      unsplashEnabled: false,
      unsplashAccessKey: undefined,
      unsplashDailyCallBudget: 40,
      officialImagesEnabled: false,
      officialImageAllowedHosts: [],
      userUploadsEnabled: true,
      imageCandidatesPerSlide: 3,
      imageMaxPerDeck: 4,
      imageMaxSearchCallsPerDeck: 6,
      imageQuotaStopRatio: 0.8,
      imageMaxDownloadBytes: 1_000_000,
      imageDownloadTimeoutMs: 5000,
    },
  };
});

const { rankImageCandidates, resolveImagesForDeck } = await import("../src/images/image-service.js");
const { ImageQuotaLedger, imageQuotaLedger } = await import("../src/images/quota-ledger.js");
const { searchPexels } = await import("../src/images/providers.js");
const { renderDeck } = await import("../src/deck/render.js");

const ONE_PIXEL_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZQmcAAAAASUVORK5CYII=",
  "base64",
);

const intent = {
  query: "editorial workspace",
  purpose: "Show the working context",
  orientation: "landscape" as const,
  preferredSource: "stock" as const,
};

beforeEach(() => imageQuotaLedger.clear());

describe("image quota and retrieval safety", () => {
  it("ranks a bounded cross-provider pool by fit and provider diversity", () => {
    const base = {
      providerAssetId: "1", previewUrl: "https://example.com/preview.jpg", downloadUrl: "https://example.com/image.jpg",
      downloadLocation: null, sourcePageUrl: "https://example.com/source", attributionText: "Example",
      creatorName: null, creatorUrl: null, localSourcePath: null,
    };
    const candidates = [
      { ...base, assetId: "pexels:portrait", provider: "pexels" as const, width: 900, height: 1600 },
      { ...base, assetId: "unsplash:landscape", provider: "unsplash" as const, width: 2400, height: 1350 },
    ];
    const ranked = rankImageCandidates(candidates, intent, new Set(), new Set(["pexels"]));

    expect(ranked[0]?.candidate.assetId).toBe("unsplash:landscape");
    expect(ranked[0]?.reasons).toContain("provider_diversity:10");
  });
  it("stops locally at 80 percent of the configured daily budget", () => {
    const ledger = new ImageQuotaLedger();
    for (let index = 0; index < 4; index += 1) {
      expect(ledger.canCall("pexels", 5, 0.8).allowed).toBe(true);
      ledger.recordAttempt("pexels");
    }
    expect(ledger.canCall("pexels", 5, 0.8)).toEqual({ allowed: false, reason: "local_daily_80_percent_stop" });
  });

  it("does not call a provider again after HTTP 429", async () => {
    const ledger = new ImageQuotaLedger();
    const fetchImpl = vi.fn(async () => new Response("rate limited", { status: 429 }));
    await expect(searchPexels(intent, {
      apiKey: "test", maxCandidates: 3, dailyBudget: 100, stopRatio: 0.8, ledger, fetchImpl,
    })).rejects.toMatchObject({ status: 429 });

    const second = await searchPexels(intent, {
      apiKey: "test", maxCandidates: 3, dailyBudget: 100, stopRatio: 0.8, ledger, fetchImpl,
    });
    expect(second.quota).toEqual({ allowed: false, reason: "http_429_long_backoff" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("re-resolves only the flagged slide and never re-picks a rejected asset", async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = input instanceof URL ? input.toString() : typeof input === "string" ? input : input.url;
      if (url.startsWith("https://api.pexels.com/v1/search")) {
        return Response.json({
          photos: [1, 2, 3].map((id) => ({
            id,
            width: 1600,
            height: 900,
            url: `https://www.pexels.com/photo/${id}/`,
            photographer: `Creator ${id}`,
            src: { medium: `https://images.pexels.com/${id}-preview.jpg`, large2x: `https://images.pexels.com/${id}.png` },
          })),
        }, { headers: { "x-ratelimit-limit": "200", "x-ratelimit-remaining": "199" } });
      }
      if (/images\.pexels\.com\/\d\.png$/.test(url)) {
        return new Response(ONE_PIXEL_PNG, { status: 200, headers: { "content-type": "image/png" } });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    const directive = {
      layout: "image_focus" as const, layoutFamily: "split_media" as const, dominantVisual: "image" as const,
      informationShape: "evidence" as const, composition: "Text and image split",
      visualAssetType: "photo" as const, imageNeed: "required" as const, imageIntent: intent,
      emphasis: "working context", avoid: [],
    };
    const result = await resolveImagesForDeck({
      runId: "image-repair-test",
      visualSystem: {
        aestheticIntent: {
          theme: "editorial_light",
          rationale: "Editorial restraint keeps the evidence readable.",
          mood: "focused",
          layoutLogic: "One image-led claim",
          imageLogic: "Use one relevant stock photo",
          avoid: ["decorative AI imagery"],
        },
        slideDirectives: [
          { slideId: "signal", ...directive },
          { slideId: "untouched", ...directive, layout: "image_left" as const },
        ],
      },
      uploadedAssetIds: [],
      officialImageUrls: [],
      onlySlideIds: ["signal"],
      excludeAssetIds: ["pexels:1"],
      fetchImpl,
    });

    expect(result.selected).toHaveLength(1);
    expect(result.selected[0]!.slideId).toBe("signal");
    expect(result.selected[0]!.assetId).not.toBe("pexels:1");
    expect(result.searchCalls).toBe(1);
  });

  it("downloads only the selected candidate after a bounded three-candidate search", async () => {
    const requested: string[] = [];
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = input instanceof URL ? input.toString() : typeof input === "string" ? input : input.url;
      requested.push(url);
      if (url.startsWith("https://api.pexels.com/v1/search")) {
        return Response.json({
          photos: [1, 2, 3].map((id) => ({
            id,
            width: 1600,
            height: 900,
            url: `https://www.pexels.com/photo/${id}/`,
            photographer: `Creator ${id}`,
            src: { medium: `https://images.pexels.com/${id}-preview.jpg`, large2x: `https://images.pexels.com/${id}.png` },
          })),
        }, { headers: { "x-ratelimit-limit": "200", "x-ratelimit-remaining": "199" } });
      }
      if (url === "https://images.pexels.com/1.png") {
        return new Response(ONE_PIXEL_PNG, { status: 200, headers: { "content-type": "image/png" } });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    const result = await resolveImagesForDeck({
      runId: "selected-only-test",
      visualSystem: {
        aestheticIntent: {
          theme: "editorial_light",
          rationale: "Editorial restraint keeps the evidence readable.",
          mood: "focused",
          layoutLogic: "One image-led claim",
          imageLogic: "Use one relevant stock photo",
          avoid: ["decorative AI imagery"],
        },
        slideDirectives: [{
          slideId: "signal", layout: "image_focus", layoutFamily: "split_media", dominantVisual: "image", informationShape: "evidence", composition: "Text and image split",
          visualAssetType: "photo",
          imageNeed: "required", imageIntent: intent, emphasis: "working context", avoid: [],
        }],
      },
      uploadedAssetIds: [],
      officialImageUrls: [],
      fetchImpl,
    });

    expect(result.selected).toHaveLength(1);
    expect(result.searchCalls).toBe(1);
    expect(requested.filter((url) => url.includes("images.pexels.com/"))).toEqual(["https://images.pexels.com/1.png"]);
    expect(requested.some((url) => url.includes("2.png") || url.includes("3.png"))).toBe(false);
    const image = result.selected[0]!;
    const noImage = { composition: "Text only", visualAssetType: "none" as const, imageNeed: "none" as const, emphasis: "message", avoid: [] };
    const deck = {
      title: "Image pipeline verification",
      subtitle: "Selected-only download",
      audience: "Reviewers",
      thesis: "Only a validated selected image reaches the renderer.",
      language: "en" as const,
      aestheticIntent: {
        theme: "editorial_light" as const,
        rationale: "Editorial restraint keeps the image and evidence readable.",
        mood: "focused",
        layoutLogic: "One image-led claim",
        imageLogic: "One selected image",
        avoid: ["decorative AI imagery"],
      },
      slides: [
        { id: "title", archetype: "title" as const, visualRole: "declaration" as const, visualDirective: { ...noImage, layout: "hero" as const, layoutFamily: "opening_hero" as const, dominantVisual: "headline" as const, informationShape: "declaration" as const }, eyebrow: "TEST", title: "Selected image only", takeaway: "", bullets: [], stats: [], notes: "Open", citations: [] },
        { id: "signal", archetype: "claim" as const, visualRole: "explanation" as const, visualDirective: { layout: "image_focus" as const, layoutFamily: "split_media" as const, dominantVisual: "image" as const, informationShape: "evidence" as const, composition: "Text and image split", visualAssetType: "photo" as const, imageNeed: "required" as const, imageIntent: intent, emphasis: "working context", avoid: [] }, eyebrow: "IMAGE", title: "The selected file is hash-bound", takeaway: "The renderer reads the same-run local asset.", bullets: ["No unselected candidate download"], stats: [], notes: "Verify", citations: [], image },
        { id: "close", archetype: "closing" as const, visualRole: "action" as const, visualDirective: { ...noImage, layout: "statement" as const, layoutFamily: "closing_statement" as const, dominantVisual: "headline" as const, informationShape: "synthesis" as const }, eyebrow: "DONE", title: "Keep the boundary visible", takeaway: "Search, select, download, verify.", bullets: [], stats: [], notes: "Close", citations: [] },
      ],
    };
    const artifact = await renderDeck(deck);
    await Promise.all([
      unlink(path.resolve("artifacts", image.localRelativePath)),
      unlink(path.resolve("artifacts", artifact.filename)),
      unlink(path.resolve("artifacts", artifact.jsonFilename)),
    ]);
  });
});
