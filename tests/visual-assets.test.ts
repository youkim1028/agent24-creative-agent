import { readFile, unlink } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { renderDeck } from "../src/deck/render.js";
import type { DeckSpec } from "../src/deck/schema.js";
import { fatalIssues, validateDeck } from "../src/deck/validate.js";

const noExternalImage = {
  imageNeed: "none" as const,
  imageIntent: null,
  avoid: ["decorative stock imagery"],
};

function visualDeck(): DeckSpec {
  return {
    title: "Native visual asset verification",
    subtitle: "Charts and diagrams stay editable in PowerPoint",
    audience: "Presentation reviewers",
    thesis: "A visual earns space only when it explains or proves the claim.",
    language: "en",
    aestheticIntent: {
      theme: "editorial_light",
      rationale: "Editorial restraint makes the native chart and process diagram easy to inspect.",
      mood: "clear and evidence-led",
      layoutLogic: "One claim and one native visual per body slide.",
      imageLogic: "Use generated visuals instead of decorative stock photography.",
      avoid: ["dashboard card grids", "decorative AI imagery"],
    },
    slides: [
      {
        id: "title", archetype: "title", visualRole: "declaration",
        visualDirective: { ...noExternalImage, layout: "hero", layoutFamily: "opening_hero", dominantVisual: "headline", informationShape: "declaration", composition: "Minimal declaration", visualAssetType: "none", emphasis: "title" },
        eyebrow: "VISUAL QA", title: "Native visuals, not decoration", takeaway: "", bullets: [], stats: [], notes: "Open.", citations: [],
      },
      {
        id: "weights", archetype: "stat", visualRole: "evidence",
        visualDirective: { ...noExternalImage, layout: "chart_focus", layoutFamily: "data_chart", dominantVisual: "data", informationShape: "comparison", composition: "Horizontal comparison", visualAssetType: "chart", emphasis: "relative weights" },
        eyebrow: "SCORE", title: "Architecture and adaptation carry half the score", takeaway: "The two largest criteria deserve the clearest demo evidence.",
        bullets: [],
        stats: [
          { value: "25%", label: "Architecture" },
          { value: "25%", label: "Adaptability" },
          { value: "20%", label: "Prompt quality" },
        ],
        notes: "Values come from the supplied judging criteria.", citations: [],
      },
      {
        id: "flow", archetype: "process", visualRole: "explanation",
        visualDirective: { ...noExternalImage, layout: "diagram_flow", layoutFamily: "process_diagram", dominantVisual: "relationship", informationShape: "sequence", composition: "Connected handoff flow", visualAssetType: "diagram", emphasis: "handoff order" },
        eyebrow: "FLOW", title: "Each role hands off a smaller, checkable contract", takeaway: "The diagram shows dependency, not decoration.",
        bullets: ["Plan — resolve context", "Research — gather signals", "Compose — build the deck", "Critique — gate rendering"],
        stats: [], notes: "Explain the bounded repair loop.", citations: [],
      },
      {
        id: "close", archetype: "closing", visualRole: "action",
        visualDirective: { ...noExternalImage, layout: "statement", layoutFamily: "closing_statement", dominantVisual: "headline", informationShape: "synthesis", composition: "Single action", visualAssetType: "none", emphasis: "download" },
        eyebrow: "OUTPUT", title: "Download the same DeckSpec that passed", takeaway: "The final PPTX remains editable and traceable.", bullets: [], stats: [], notes: "Close.", citations: [],
      },
    ],
  };
}

describe("native visual assets", () => {
  it("requires real numeric stats for chart layouts", () => {
    const deck = visualDeck();
    deck.slides[1]!.stats = [{ value: "many", label: "Architecture" }, { value: "strong", label: "Adaptability" }];
    const validation = validateDeck(deck);
    expect(validation.issues.some((issue) => issue.code === "CHART_INPUT_MISSING")).toBe(true);
  });

  it("renders an editable native chart and connected diagram into the downloadable PPTX", async () => {
    const validation = validateDeck(visualDeck());
    expect(fatalIssues(validation.issues)).toEqual([]);
    expect(validation.deck).not.toBeNull();

    const artifact = await renderDeck(validation.deck!);
    const pptxPath = path.resolve("artifacts", artifact.filename);
    const pptx = await readFile(pptxPath);
    expect(pptx.byteLength).toBeGreaterThan(10_000);

    await Promise.all([
      unlink(pptxPath),
      unlink(path.resolve("artifacts", artifact.jsonFilename)),
    ]);
  });

  it.each([
    ["timeline", "timeline", "sequence", "chronology", ["1891 ??indoor origin", "1936 ??Olympic stage", "today ??global game"]],
    ["spatial_map", "spatial_map", "relationship", "spatial", ["Guard ??organizes", "Wing ??creates space", "Center ??protects the rim"]],
  ] as const)("renders the %s information shape with native editable geometry", async (layout, layoutFamily, dominantVisual, informationShape, bullets) => {
    const deck = visualDeck();
    deck.slides[2]!.visualDirective = {
      ...deck.slides[2]!.visualDirective,
      layout,
      layoutFamily,
      dominantVisual,
      informationShape,
      composition: `Content-led ${layout}`,
      visualAssetType: "diagram",
    };
    deck.slides[2]!.bullets = [...bullets];
    const validation = validateDeck(deck);
    expect(fatalIssues(validation.issues)).toEqual([]);

    const artifact = await renderDeck(validation.deck!);
    const pptxPath = path.resolve("artifacts", artifact.filename);
    expect((await readFile(pptxPath)).byteLength).toBeGreaterThan(10_000);
    await Promise.all([unlink(pptxPath), unlink(path.resolve("artifacts", artifact.jsonFilename))]);
  });
});
