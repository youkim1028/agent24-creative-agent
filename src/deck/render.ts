import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import PptxGenModule from "pptxgenjs";
import type { DeckArtifact, DeckSpec, SlideSpec } from "./schema.js";

// PptxGenJS can arrive as either the constructor or a default-wrapped constructor,
// depending on whether Node or tsx loads the package. Keep the interop isolated.
type PptxPresentation = any;
type PptxSlide = any;
const PptxGenJS = ((PptxGenModule as any).default ?? PptxGenModule) as new () => PptxPresentation;

type ThemeColors = {
  ink: string;
  paper: string;
  white: string;
  muted: string;
  acid: string;
  purple: string;
  line: string;
  panel: string;
};

const THEMES: Record<DeckSpec["aestheticIntent"]["theme"], ThemeColors> = {
  ink_acid: {
  ink: "121411",
  paper: "F4F3ED",
  white: "FFFFFF",
  muted: "858B80",
  acid: "D9FF54",
  purple: "7058FF",
  line: "343832",
  panel: "1A1D18",
  },
  editorial_light: {
    ink: "F7F5EF",
    paper: "F7F5EF",
    white: "171914",
    muted: "687066",
    acid: "C14B35",
    purple: "315C72",
    line: "C9C6BA",
    panel: "FFFFFF",
  },
  warm_documentary: {
    ink: "2B211B",
    paper: "F2E7D5",
    white: "FFF8EC",
    muted: "B6A28F",
    acid: "E8A24A",
    purple: "B85C48",
    line: "5E4638",
    panel: "3A2B22",
  },
  mono_evidence: {
    ink: "111111",
    paper: "EFEFEF",
    white: "FFFFFF",
    muted: "9A9A9A",
    acid: "FFFFFF",
    purple: "BDBDBD",
    line: "4A4A4A",
    panel: "222222",
  },
};

function themeColors(theme: DeckSpec["aestheticIntent"]["theme"]): ThemeColors {
  return THEMES[theme] ?? THEMES.ink_acid;
}

function safeName(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48)
    .toLocaleLowerCase() || "deckforge-x";
}

function addChrome(pptx: PptxPresentation, slide: PptxSlide, index: number, total: number, colors: ThemeColors): void {
  slide.addText("DECKFORGE / GPT × GROK X", {
    x: 0.6, y: 0.28, w: 4.4, h: 0.22, fontFace: "Aptos Mono", fontSize: 8,
    color: colors.muted, charSpacing: 1.4, margin: 0,
  });
  slide.addText(`${String(index + 1).padStart(2, "0")} / ${String(total).padStart(2, "0")}`, {
    x: 11.8, y: 0.28, w: 0.9, h: 0.22, align: "right", fontFace: "Aptos Mono",
    fontSize: 8, color: colors.muted, margin: 0,
  });
  slide.addShape(pptx.ShapeType.line, { x: 0.6, y: 0.62, w: 12.1, h: 0, line: { color: colors.line, width: 0.7 } });
}

function addCitations(slide: PptxSlide, spec: SlideSpec, colors: ThemeColors): void {
  if (spec.citations.length === 0) return;
  const labels = spec.citations.slice(0, 3).map((citation, index) => `[${index + 1}] ${citation.handle || citation.title}`).join("   ");
  slide.addText(labels, {
    x: 0.7, y: 7.08, w: 11.9, h: 0.2, fontFace: "Malgun Gothic", fontSize: 7.5,
    color: colors.muted, margin: 0, breakLine: false,
  });
}

function addTitleSlide(pptx: PptxPresentation, slide: PptxSlide, deck: DeckSpec, spec: SlideSpec, colors: ThemeColors): void {
  slide.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 0.22, h: 7.5, line: { color: colors.acid, transparency: 100 }, fill: { color: colors.acid } });
  slide.addText(spec.eyebrow || "LIVE X SIGNALS → DECISION DECK", {
    x: 0.8, y: 1.45, w: 7.8, h: 0.3, fontFace: "Aptos Mono", fontSize: 10,
    color: colors.acid, bold: true, charSpacing: 1.5, margin: 0,
  });
  slide.addText(spec.title || deck.title, {
    x: 0.75, y: 1.8, w: 11.5, h: 2.45, fontFace: "Malgun Gothic", fontSize: 50,
    color: colors.white, bold: true, breakLine: false, valign: "mid", margin: 0.04,
  });
  slide.addText(deck.subtitle || deck.thesis, {
    x: 0.8, y: 4.55, w: 9.8, h: 0.85, fontFace: "Malgun Gothic", fontSize: 18,
    color: colors.muted, margin: 0, breakLine: false,
  });
  slide.addText(`AUDIENCE  ${deck.audience}`, {
    x: 0.8, y: 6.3, w: 7.5, h: 0.3, fontFace: "Aptos Mono", fontSize: 9,
    color: colors.muted, margin: 0,
  });
}

function addContentSlide(pptx: PptxPresentation, slide: PptxSlide, spec: SlideSpec, colors: ThemeColors): void {
  slide.addText(spec.eyebrow || spec.archetype.toUpperCase(), {
    x: 0.7, y: 0.92, w: 4, h: 0.28, fontFace: "Aptos Mono", fontSize: 9,
    color: colors.purple, bold: true, charSpacing: 1.2, margin: 0,
  });
  slide.addText(spec.title, {
    x: 0.68, y: 1.25, w: 11.8, h: 1.25, fontFace: "Malgun Gothic", fontSize: 35,
    color: colors.white, bold: true, margin: 0, breakLine: false,
  });
  if (spec.takeaway) {
    slide.addText(spec.takeaway, {
      x: 0.72, y: 2.58, w: 11.2, h: 0.72, fontFace: "Malgun Gothic", fontSize: 18,
      color: "DDE1D8", bold: false, margin: 0, breakLine: false,
    });
  }

  if (spec.stats.length > 0) {
    const width = Math.min(3.7, 11.4 / spec.stats.length);
    spec.stats.forEach((stat, index) => {
      const x = 0.72 + index * (width + 0.18);
      slide.addShape(pptx.ShapeType.roundRect, { x, y: 3.6, w: width, h: 1.8, rectRadius: 0.06, line: { color: colors.line, width: 1 }, fill: { color: colors.panel } });
      slide.addText(stat.value, { x: x + 0.18, y: 3.86, w: width - 0.36, h: 0.62, fontFace: "Aptos Display", fontSize: 32, bold: true, color: colors.acid, margin: 0 });
      slide.addText(stat.label, { x: x + 0.18, y: 4.62, w: width - 0.36, h: 0.46, fontFace: "Malgun Gothic", fontSize: 16, color: colors.muted, margin: 0 });
    });
  } else if (spec.bullets.length > 0) {
    const runs = spec.bullets.map((bullet) => ({ text: bullet, options: { bullet: { indent: 16 }, hanging: 4, breakLine: true } }));
    slide.addText(runs, {
      x: 0.78, y: 3.58, w: 10.9, h: 2.45, fontFace: "Malgun Gothic", fontSize: 18,
      color: colors.white, breakLine: false, paraSpaceAfterPt: 14, margin: 0.03,
    });
  }
  addCitations(slide, spec, colors);
}

function addClosingSlide(pptx: PptxPresentation, slide: PptxSlide, deck: DeckSpec, spec: SlideSpec, colors: ThemeColors): void {
  slide.addText("THE ONE THING TO REMEMBER", {
    x: 0.75, y: 1.42, w: 5.5, h: 0.3, fontFace: "Aptos Mono", fontSize: 9,
    color: colors.acid, bold: true, charSpacing: 1.3, margin: 0,
  });
  slide.addText(spec.title, {
    x: 0.72, y: 1.85, w: 11.4, h: 2.35, fontFace: "Malgun Gothic", fontSize: 42,
    color: colors.white, bold: true, margin: 0, valign: "mid", breakLine: false,
  });
  slide.addShape(pptx.ShapeType.line, { x: 0.75, y: 4.62, w: 2.2, h: 0, line: { color: colors.purple, width: 4 } });
  slide.addText(spec.takeaway || deck.thesis, {
    x: 0.75, y: 4.95, w: 10.5, h: 1.05, fontFace: "Malgun Gothic", fontSize: 18,
    color: colors.muted, margin: 0,
  });
  addCitations(slide, spec, colors);
}

function speakerNotes(spec: SlideSpec): string {
  const sourceLines = spec.citations.length > 0
    ? spec.citations.map((citation) => `- ${citation.url} — ${citation.title}`)
    : ["- No external source used on this slide."];
  return [
    spec.notes || "No presenter notes provided.",
    "",
    "[Sources]",
    ...sourceLines,
    "[/Sources]",
  ].join("\n");
}

export async function renderDeck(deck: DeckSpec): Promise<DeckArtifact> {
  const pptx = new PptxGenJS();
  const colors = themeColors(deck.aestheticIntent.theme);
  pptx.layout = "LAYOUT_WIDE";
  pptx.author = "DeckForge GPT × Grok";
  pptx.company = "Agent24";
  pptx.subject = deck.thesis;
  pptx.title = deck.title;
  pptx.lang = deck.language === "ko" ? "ko-KR" : "en-US";
  pptx.theme = {
    headFontFace: deck.language === "ko" ? "Malgun Gothic" : "Aptos Display",
    bodyFontFace: deck.language === "ko" ? "Malgun Gothic" : "Aptos",
    lang: deck.language === "ko" ? "ko-KR" : "en-US",
  };

  deck.slides.forEach((spec, index) => {
    const slide = pptx.addSlide();
    slide.background = { color: colors.ink };
    addChrome(pptx, slide, index, deck.slides.length, colors);
    if (spec.archetype === "title") addTitleSlide(pptx, slide, deck, spec, colors);
    else if (spec.archetype === "closing") addClosingSlide(pptx, slide, deck, spec, colors);
    else addContentSlide(pptx, slide, spec, colors);
    slide.addNotes(speakerNotes(spec));
  });

  const directory = path.resolve("artifacts");
  await mkdir(directory, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const base = `${safeName(deck.title)}-${stamp}`;
  const filename = `${base}.pptx`;
  const jsonFilename = `${base}.json`;
  await pptx.writeFile({ fileName: path.join(directory, filename) });
  await writeFile(path.join(directory, jsonFilename), JSON.stringify(deck, null, 2), "utf8");
  return {
    filename,
    jsonFilename,
    downloadUrl: `/api/artifacts/${encodeURIComponent(filename)}`,
    jsonUrl: `/api/artifacts/${encodeURIComponent(jsonFilename)}`,
  };
}
