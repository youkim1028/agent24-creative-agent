import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import PptxGenModule from "pptxgenjs";
import type { DeckArtifact, DeckSpec, SlideSpec } from "./schema.js";

// PptxGenJS can arrive as either the constructor or a default-wrapped constructor,
// depending on whether Node or tsx loads the package. Keep the interop isolated.
type PptxPresentation = any;
type PptxSlide = any;
const PptxGenJS = ((PptxGenModule as any).default ?? PptxGenModule) as new () => PptxPresentation;

// Each aesthetic theme is a real design system, not a recolor: its own surfaces
// for body and cover slides, its own accent, and a light or dark stance. Cover
// slides (title/closing) deliberately flip contrast on the light themes — the
// classic dark-light-dark sandwich — so a deck has an arc instead of five
// identical cards.
type Surface = {
  bg: string;
  text: string;
  soft: string;
  muted: string;
  line: string;
  panel: string;
};

type ThemeSpec = {
  accent: string;
  accentInk: string; // text color that stays readable ON the accent
  body: Surface;
  cover: Surface;
};

const THEMES: Record<DeckSpec["aestheticIntent"]["theme"], ThemeSpec> = {
  ink_acid: {
    accent: "D9FF54",
    accentInk: "10140D",
    body: { bg: "141712", text: "F2F4EE", soft: "C9CFC2", muted: "7E8678", line: "272C24", panel: "1B201A", },
    cover: { bg: "0E120C", text: "F5F7F0", soft: "B9C1B1", muted: "77816F", line: "232921", panel: "161B14" },
  },
  editorial_light: {
    accent: "C14B35",
    accentInk: "FFFFFF",
    body: { bg: "F6F4ED", text: "1D1F1A", soft: "4C5047", muted: "8E9288", line: "DDD9CC", panel: "FFFFFF" },
    cover: { bg: "17352E", text: "F7F5EF", soft: "CFD8CF", muted: "8FA398", line: "2A473F", panel: "1E403A" },
  },
  warm_documentary: {
    accent: "E8A24A",
    accentInk: "2A1D10",
    body: { bg: "2A211B", text: "F6EDDF", soft: "D8C9B4", muted: "9A8871", line: "3C3128", panel: "332822" },
    cover: { bg: "1F1812", text: "F8F0E2", soft: "CDBBA2", muted: "8F7E67", line: "342A20", panel: "281F17" },
  },
  mono_evidence: {
    accent: "161616",
    accentInk: "F4F4F2",
    body: { bg: "F1F1EF", text: "161616", soft: "3E3E3E", muted: "8C8C8C", line: "D8D8D4", panel: "FFFFFF" },
    cover: { bg: "141414", text: "F5F5F3", soft: "C9C9C5", muted: "858581", line: "2B2B2B", panel: "1D1D1D" },
  },
};

const MONO = "Consolas";
const CANVAS = { w: 13.33, h: 7.5 };

function themeSpec(theme: DeckSpec["aestheticIntent"]["theme"]): ThemeSpec {
  return THEMES[theme] ?? THEMES.ink_acid;
}

// mono_evidence's near-black accent vanishes on its own black covers; when the
// accent and the surface are too close in luminance, flip to accentInk.
function accentOn(theme: ThemeSpec, surface: Surface): string {
  const luminance = (hex: string) =>
    parseInt(hex.slice(0, 2), 16) * 0.299 + parseInt(hex.slice(2, 4), 16) * 0.587 + parseInt(hex.slice(4, 6), 16) * 0.114;
  return Math.abs(luminance(theme.accent) - luminance(surface.bg)) < 60 ? theme.accentInk : theme.accent;
}

function bodyFont(deck: DeckSpec): string {
  return deck.language === "ko" ? "Malgun Gothic" : "Calibri";
}

function safeName(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48)
    .toLocaleLowerCase() || "deckforge-x";
}

// "라벨 — 설명" / "라벨: 설명" bullets carry their own hierarchy; render the label
// as a bold lead-in so lists read as structured rows, not flat sentences.
function labelRuns(bullet: string, surface: Surface, accent: string, fontSize: number): Array<{ text: string; options: Record<string, unknown> }> {
  const match = bullet.match(/^(.{1,26}?)\s*(?:—|–|:)\s+(.+)$/);
  if (!match) {
    return [{ text: bullet, options: { bullet: { indent: 14 }, hanging: 4, breakLine: true, color: surface.soft, fontSize } }];
  }
  return [
    { text: `${match[1]}  `, options: { bullet: { indent: 14 }, hanging: 4, bold: true, color: surface.text, fontSize } },
    { text: match[2]!, options: { color: surface.soft, breakLine: true, fontSize } },
  ];
}

function addBulletBlock(
  slide: PptxSlide,
  bullets: string[],
  surface: Surface,
  accent: string,
  font: string,
  box: { x: number; y: number; w: number; h: number },
  fontSize: number,
  spaceAfter = 10,
): void {
  const runs = bullets.slice(0, 5).flatMap((bullet) => labelRuns(bullet, surface, accent, fontSize));
  slide.addText(runs, {
    x: box.x, y: box.y, w: box.w, h: box.h, fontFace: font,
    paraSpaceAfterPt: spaceAfter, margin: 0.03, valign: "top",
  });
}

// A short, punchy set of cover points ("LAND · LOOT · SURVIVE") reads as a motif
// row instead of a bullet list — one of the devices audiences read as "designed".
function isMotifRow(bullets: string[]): boolean {
  return bullets.length >= 2 && bullets.length <= 4 && bullets.every((bullet) => bullet.length <= 14 && !/[—:]/.test(bullet));
}

function addGhostNumber(slide: PptxSlide, index: number, surface: Surface): void {
  slide.addText(String(index + 1).padStart(2, "0"), {
    x: 10.15, y: 4.55, w: 3.4, h: 3.1, align: "right", fontFace: MONO,
    fontSize: 150, bold: true, color: surface.line, margin: 0, valign: "bottom",
  });
}

function addPageMarker(slide: PptxSlide, index: number, total: number, surface: Surface): void {
  slide.addText(`${String(index + 1).padStart(2, "0")} / ${String(total).padStart(2, "0")}`, {
    x: 11.9, y: 0.42, w: 1.05, h: 0.26, align: "right", fontFace: MONO,
    fontSize: 10, color: surface.muted, margin: 0,
  });
}

function addEyebrow(slide: PptxSlide, text: string, accent: string, y: number, onImage = false, x = 0.9, w = 10.4): void {
  if (!text) return;
  slide.addText(text.toUpperCase(), {
    x, y, w, h: 0.3, fontFace: MONO, fontSize: 11.5,
    color: accent, charSpacing: 2.4, margin: 0, bold: onImage,
  });
}

function addCitations(slide: PptxSlide, spec: SlideSpec, surface: Surface): void {
  if (spec.citations.length === 0) return;
  const labels = spec.citations.slice(0, 3).map((citation) => citation.handle || citation.title).join(" · ");
  slide.addText(labels, {
    x: 0.9, y: 7.06, w: 11.6, h: 0.22, fontFace: MONO, fontSize: 8,
    color: surface.muted, margin: 0, breakLine: false,
  });
}

function resolvedImagePath(spec: SlideSpec): string | null {
  if (!spec.image) return null;
  const root = path.resolve("artifacts", "images");
  const resolved = path.resolve("artifacts", spec.image.localRelativePath);
  return resolved.startsWith(`${root}${path.sep}`) ? resolved : null;
}

function addImageAttribution(slide: PptxSlide, spec: SlideSpec, surface: Surface, box: { x: number; y: number; w: number }): void {
  if (!spec.image) return;
  slide.addText(spec.image.attributionText, {
    x: box.x, y: box.y, w: box.w, h: 0.2,
    fontFace: MONO, fontSize: 7, color: surface.muted, margin: 0,
    ...(spec.image.creatorUrl || spec.image.sourcePageUrl ? { hyperlink: { url: spec.image.creatorUrl ?? spec.image.sourcePageUrl } } : {}),
  });
}

// Full-bleed subject imagery with a scrim is what makes a cover feel like it
// belongs to THIS topic instead of a template.
function addFullBleedImage(slide: PptxSlide, spec: SlideSpec, surface: Surface): boolean {
  const imagePath = resolvedImagePath(spec);
  if (!imagePath || !spec.image) return false;
  slide.addImage({ path: imagePath, x: 0, y: 0, w: CANVAS.w, h: CANVAS.h, sizing: { type: "cover", w: CANVAS.w, h: CANVAS.h } });
  slide.addShape("rect", { x: 0, y: 0, w: CANVAS.w, h: CANVAS.h, fill: { color: surface.bg, transparency: 32 }, line: { color: surface.bg, transparency: 100 } });
  return true;
}

function addHalfBleedImage(slide: PptxSlide, spec: SlideSpec, surface: Surface, side: "left" | "right"): boolean {
  const imagePath = resolvedImagePath(spec);
  if (!imagePath || !spec.image) return false;
  const w = 5.6;
  const x = side === "left" ? 0 : CANVAS.w - w;
  slide.addImage({ path: imagePath, x, y: 0, w, h: CANVAS.h, sizing: { type: "cover", w, h: CANVAS.h } });
  addImageAttribution(slide, spec, surface, { x: side === "left" ? 0.25 : x + 0.25, y: 7.14, w: w - 0.5 });
  return true;
}

function addPanelImage(pptx: PptxPresentation, slide: PptxSlide, spec: SlideSpec, surface: Surface, box: { x: number; y: number; w: number; h: number }): void {
  const imagePath = resolvedImagePath(spec);
  if (!imagePath || !spec.image) return;
  slide.addShape(pptx.ShapeType.roundRect, { ...box, rectRadius: 0.08, line: { color: surface.line, width: 1 }, fill: { color: surface.panel } });
  const sourceRatio = spec.image.width / spec.image.height;
  const boxRatio = box.w / box.h;
  const fitted = sourceRatio > boxRatio ? { w: box.w, h: box.w / sourceRatio } : { w: box.h * sourceRatio, h: box.h };
  slide.addImage({ path: imagePath, x: box.x + (box.w - fitted.w) / 2, y: box.y + (box.h - fitted.h) / 2, w: fitted.w, h: fitted.h });
  addImageAttribution(slide, spec, surface, { x: box.x, y: box.y + box.h + 0.08, w: box.w });
}

function numericStatValue(value: string): number | null {
  const normalized = value.replace(/,/g, "").match(/-?\d+(?:\.\d+)?/u)?.[0];
  if (!normalized) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function addNativeChart(
  pptx: PptxPresentation,
  slide: PptxSlide,
  spec: SlideSpec,
  surface: Surface,
  theme: ThemeSpec,
  font: string,
): void {
  const stats = spec.stats
    .map((stat) => ({ ...stat, numericValue: numericStatValue(stat.value) }))
    .filter((stat): stat is typeof stat & { numericValue: number } => stat.numericValue !== null)
    .slice(0, 3);
  if (stats.length < 2) return;
  slide.addChart(pptx.ChartType.bar, [{
    name: spec.eyebrow || spec.title,
    labels: stats.map((stat) => stat.label),
    values: stats.map((stat) => stat.numericValue),
  }], {
    x: 0.92, y: 3.05, w: 11.45, h: 3.45,
    catAxisLabelColor: surface.soft,
    catAxisLabelFontFace: font,
    catAxisLabelFontSize: 13,
    valAxisLabelColor: surface.muted,
    valAxisLabelFontFace: MONO,
    valAxisLabelFontSize: 10,
    chartColors: [theme.accent],
    barDir: "bar",
    catAxisLabelPos: "low",
    dataLabelPosition: "outEnd",
    showLegend: false,
    showTitle: false,
    showValue: true,
    showCatName: false,
    showValAxisTitle: false,
    showCatAxisTitle: false,
    showBorder: false,
    showGridLines: false,
  });
}

function splitDiagramLabel(value: string): { label: string; description: string } {
  const match = value.match(/^(.{1,26}?)\s*(?:—|–|:)\s+(.+)$/u);
  return match ? { label: match[1]!, description: match[2]! } : { label: value, description: "" };
}

function addNativeDiagram(
  pptx: PptxPresentation,
  slide: PptxSlide,
  spec: SlideSpec,
  surface: Surface,
  theme: ThemeSpec,
  font: string,
): void {
  const nodes = spec.bullets.slice(0, 5).map(splitDiagramLabel);
  if (nodes.length < 2) return;
  const left = 0.92;
  const gap = 0.28;
  const totalWidth = 11.45;
  const nodeWidth = (totalWidth - gap * (nodes.length - 1)) / nodes.length;
  const nodeY = 3.45;
  const nodeH = 2.05;

  // Connectors are created first so they remain behind every node and label.
  for (let index = 0; index < nodes.length - 1; index += 1) {
    const x = left + nodeWidth * (index + 1) + gap * index + 0.03;
    slide.addShape(pptx.ShapeType.line, {
      x, y: nodeY + nodeH / 2, w: gap - 0.06, h: 0,
      line: { color: theme.accent, width: 1.8, endArrowType: "triangle" },
    });
  }
  nodes.forEach((node, index) => {
    const x = left + index * (nodeWidth + gap);
    slide.addShape(pptx.ShapeType.roundRect, {
      x, y: nodeY, w: nodeWidth, h: nodeH, rectRadius: 0.08,
      fill: { color: surface.panel }, line: { color: index === 0 ? theme.accent : surface.line, width: index === 0 ? 2 : 1 },
    });
    slide.addText(String(index + 1).padStart(2, "0"), {
      x: x + 0.2, y: nodeY + 0.2, w: nodeWidth - 0.4, h: 0.25,
      fontFace: MONO, fontSize: 10, bold: true, color: theme.accent, margin: 0,
    });
    slide.addText(node.label, {
      x: x + 0.2, y: nodeY + 0.62, w: nodeWidth - 0.4, h: 0.58,
      fontFace: font, fontSize: nodes.length >= 5 ? 15 : 17, bold: true,
      color: surface.text, margin: 0, valign: "mid", breakLine: false,
    });
    if (node.description) {
      slide.addText(node.description, {
        x: x + 0.2, y: nodeY + 1.3, w: nodeWidth - 0.4, h: 0.48,
        fontFace: font, fontSize: nodes.length >= 5 ? 10.5 : 11.5,
        color: surface.soft, margin: 0, valign: "top",
      });
    }
  });
}

function addTimeline(
  pptx: PptxPresentation,
  slide: PptxSlide,
  spec: SlideSpec,
  surface: Surface,
  theme: ThemeSpec,
  font: string,
): void {
  const nodes = spec.bullets.slice(0, 5).map(splitDiagramLabel);
  if (nodes.length < 2) return;
  const left = 1.0;
  const right = 12.2;
  const y = 4.2;
  const step = (right - left) / (nodes.length - 1);
  slide.addShape(pptx.ShapeType.line, {
    x: left, y, w: right - left, h: 0,
    line: { color: surface.line, width: 1.4 },
  });
  nodes.forEach((node, index) => {
    const x = left + step * index;
    const above = index % 2 === 0;
    slide.addShape(pptx.ShapeType.ellipse, {
      x: x - 0.09, y: y - 0.09, w: 0.18, h: 0.18,
      fill: { color: theme.accent }, line: { color: theme.accent, width: 0 },
    });
    slide.addText(node.label, {
      x: Math.max(0.72, Math.min(10.85, x - 0.72)), y: above ? 3.25 : 4.48, w: 1.8, h: 0.42,
      fontFace: font, fontSize: 15, bold: true, color: surface.text, margin: 0,
      align: index === nodes.length - 1 ? "right" : index === 0 ? "left" : "center",
    });
    if (node.description) {
      slide.addText(node.description, {
        x: Math.max(0.72, Math.min(10.85, x - 0.72)), y: above ? 3.66 : 4.89, w: 1.8, h: 0.72,
        fontFace: font, fontSize: 10.5, color: surface.soft, margin: 0,
        align: index === nodes.length - 1 ? "right" : index === 0 ? "left" : "center",
      });
    }
  });
}

function addSpatialMap(
  pptx: PptxPresentation,
  slide: PptxSlide,
  spec: SlideSpec,
  surface: Surface,
  theme: ThemeSpec,
  font: string,
): void {
  const nodes = spec.bullets.slice(0, 5).map(splitDiagramLabel);
  if (nodes.length < 2) return;
  const center = { x: 5.15, y: 3.62, w: 3.0, h: 1.35 };
  const positions = [
    { x: 0.95, y: 3.15 },
    { x: 9.85, y: 3.15 },
    { x: 1.7, y: 5.35 },
    { x: 9.1, y: 5.35 },
    { x: 5.35, y: 5.75 },
  ];
  nodes.forEach((_, index) => {
    const node = positions[index]!;
    const startX = node.x < center.x ? node.x + 2.55 : node.x;
    const startY = node.y + 0.55;
    slide.addShape(pptx.ShapeType.line, {
      x: Math.min(startX, center.x + center.w / 2),
      y: Math.min(startY, center.y + center.h / 2),
      w: Math.abs(center.x + center.w / 2 - startX),
      h: Math.abs(center.y + center.h / 2 - startY),
      line: { color: surface.line, width: 1.2 },
    });
  });
  slide.addShape(pptx.ShapeType.ellipse, {
    ...center, fill: { color: theme.accent }, line: { color: theme.accent, width: 0 },
  });
  slide.addText(spec.takeaway || spec.title, {
    x: center.x + 0.3, y: center.y + 0.25, w: center.w - 0.6, h: center.h - 0.5,
    fontFace: font, fontSize: 14, bold: true, color: theme.accentInk, margin: 0,
    align: "center", valign: "mid", fit: "shrink",
  });
  nodes.forEach((node, index) => {
    const position = positions[index]!;
    slide.addShape(pptx.ShapeType.roundRect, {
      x: position.x, y: position.y, w: 2.55, h: 1.12, rectRadius: 0.08,
      fill: { color: surface.panel }, line: { color: surface.line, width: 1 },
    });
    slide.addText(node.label, {
      x: position.x + 0.18, y: position.y + 0.16, w: 2.19, h: 0.32,
      fontFace: font, fontSize: 13.5, bold: true, color: surface.text, margin: 0,
    });
    if (node.description) {
      slide.addText(node.description, {
        x: position.x + 0.18, y: position.y + 0.53, w: 2.19, h: 0.42,
        fontFace: font, fontSize: 9.5, color: surface.soft, margin: 0, fit: "shrink",
      });
    }
  });
}

// The deck's identity mark: a small logo-like composition drawn from native
// shapes on the covers. Generated, never fetched — each kind is a fixed geometry
// recolored by the theme, so the mark stays editable in PowerPoint.
function addEmblem(pptx: PptxPresentation, slide: PptxSlide, deck: DeckSpec, theme: ThemeSpec, surface: Surface): void {
  const emblem = deck.aestheticIntent.emblem;
  if (!emblem) return;
  const x = 12.08;
  const y = 0.84;
  const s = 0.62;
  const accent = accentOn(theme, surface);
  const accentLine = { color: accent, width: 1.6 };
  const softLine = { color: surface.soft, width: 1.1 };
  const noFill = { color: surface.bg, transparency: 100 };
  if (emblem.kind === "concentric_rings") {
    slide.addShape(pptx.ShapeType.ellipse, { x, y, w: s, h: s, fill: noFill, line: accentLine });
    slide.addShape(pptx.ShapeType.ellipse, { x: x + s * 0.17, y: y + s * 0.17, w: s * 0.66, h: s * 0.66, fill: noFill, line: softLine });
    slide.addShape(pptx.ShapeType.ellipse, { x: x + s * 0.42, y: y + s * 0.42, w: s * 0.16, h: s * 0.16, fill: { color: accent }, line: { color: accent, width: 0 } });
  } else if (emblem.kind === "orbit_dot") {
    slide.addShape(pptx.ShapeType.ellipse, { x, y, w: s, h: s, fill: noFill, line: softLine });
    slide.addShape(pptx.ShapeType.ellipse, { x: x + s * 0.78, y: y - s * 0.04, w: s * 0.26, h: s * 0.26, fill: { color: accent }, line: { color: accent, width: 0 } });
  } else if (emblem.kind === "dot_grid") {
    const d = s * 0.18;
    const gap = (s - d * 3) / 2;
    for (let row = 0; row < 3; row += 1) {
      for (let col = 0; col < 3; col += 1) {
        const last = row === 2 && col === 2;
        slide.addShape(pptx.ShapeType.ellipse, {
          x: x + col * (d + gap), y: y + row * (d + gap), w: d, h: d,
          fill: { color: last ? accent : surface.muted }, line: { color: last ? accent : surface.muted, width: 0 },
        });
      }
    }
  } else if (emblem.kind === "line_stack") {
    const widths = [1, 0.72, 0.5, 0.3];
    widths.forEach((ratio, row) => {
      slide.addShape(pptx.ShapeType.line, {
        x, y: y + 0.06 + row * (s / widths.length), w: s * ratio, h: 0,
        line: row === 0 ? { color: accent, width: 2.4 } : { color: surface.soft, width: 1.2 },
      });
    });
  } else if (emblem.kind === "triangle_peak") {
    slide.addShape(pptx.ShapeType.triangle, { x, y, w: s, h: s * 0.78, fill: noFill, line: accentLine });
    slide.addShape(pptx.ShapeType.line, { x: x - s * 0.08, y: y + s * 0.92, w: s * 1.16, h: 0, line: softLine });
  }
}

function addTitleSlide(pptx: PptxPresentation, slide: PptxSlide, deck: DeckSpec, spec: SlideSpec, theme: ThemeSpec): void {
  const surface = theme.cover;
  const font = bodyFont(deck);
  const accent = accentOn(theme, surface);
  const fullBleed = addFullBleedImage(slide, spec, surface);
  addEmblem(pptx, slide, deck, theme, surface);
  addEyebrow(slide, spec.eyebrow, accent, 0.72, fullBleed);
  slide.addText(spec.title || deck.title, {
    x: 0.86, y: 1.55, w: 11.6, h: 2.5, fontFace: font, fontSize: 47,
    color: surface.text, bold: true, breakLine: false, valign: "mid", margin: 0.04,
  });
  slide.addText(deck.subtitle || deck.thesis, {
    x: 0.9, y: 4.25, w: 10.4, h: 0.8, fontFace: font, fontSize: 17,
    color: surface.soft, margin: 0, breakLine: false,
  });
  if (spec.bullets.length > 0) {
    if (isMotifRow(spec.bullets)) {
      slide.addText(spec.bullets.map((b) => b.toUpperCase()).join("   ·   "), {
        x: 0.9, y: 5.35, w: 11.4, h: 0.5, fontFace: MONO, fontSize: 17,
        color: accent, bold: true, charSpacing: 3, margin: 0,
      });
    } else {
      addBulletBlock(slide, spec.bullets, surface, accent, font, { x: 0.95, y: 5.15, w: 10.8, h: 1.35 }, 13.5, 6);
    }
  }
  slide.addText(`AUDIENCE  ${deck.audience}`, {
    x: 0.9, y: 6.85, w: 9.0, h: 0.26, fontFace: MONO, fontSize: 9,
    color: surface.muted, margin: 0,
  });
  if (fullBleed && spec.image) addImageAttribution(slide, spec, surface, { x: 9.6, y: 7.14, w: 3.5 });
}

function addClosingSlide(pptx: PptxPresentation, slide: PptxSlide, deck: DeckSpec, spec: SlideSpec, theme: ThemeSpec): void {
  const surface = theme.cover;
  const font = bodyFont(deck);
  const accent = accentOn(theme, surface);
  const fullBleed = addFullBleedImage(slide, spec, surface);
  addEmblem(pptx, slide, deck, theme, surface);
  addEyebrow(slide, spec.eyebrow || (deck.language === "ko" ? "마지막으로 기억할 것" : "The one thing to remember"), accent, 0.72, fullBleed);
  slide.addText(spec.title, {
    x: 0.86, y: 1.5, w: 11.6, h: 2.2, fontFace: font, fontSize: 42,
    color: surface.text, bold: true, margin: 0, valign: "mid", breakLine: false,
  });
  slide.addText(spec.takeaway || deck.thesis, {
    x: 0.9, y: 3.95, w: 10.6, h: 0.85, fontFace: font, fontSize: 17,
    color: surface.soft, margin: 0,
  });
  if (spec.bullets.length > 0) {
    addBulletBlock(slide, spec.bullets, surface, accent, font, { x: 0.95, y: 5.05, w: 10.8, h: 1.8 }, 13.5, 7);
  }
  if (fullBleed && spec.image) addImageAttribution(slide, spec, surface, { x: 9.6, y: 7.14, w: 3.5 });
  addCitations(slide, spec, surface);
}

function addContentSlide(pptx: PptxPresentation, slide: PptxSlide, deck: DeckSpec, spec: SlideSpec, theme: ThemeSpec, index: number): void {
  const surface = theme.body;
  const font = bodyFont(deck);
  const layout = spec.visualDirective.layout;
  const imageSide = layout === "image_left" ? "left" : "right";
  const halfBleed = ["image_focus", "image_left"].includes(layout) && addHalfBleedImage(slide, spec, surface, imageSide);
  const contentX = halfBleed && imageSide === "left" ? 6.18 : 0.9;
  const contentW = halfBleed ? 6.4 : 11.6;
  if (!halfBleed && layout === "evidence_focus") addGhostNumber(slide, index, surface);

  addEyebrow(slide, spec.eyebrow || spec.archetype, theme.accent, 0.55, false, contentX, contentW - 0.2);
  slide.addText(spec.title, {
    x: contentX - 0.04, y: 1.0, w: contentW, h: 1.25, fontFace: font, fontSize: halfBleed ? 27 : 31,
    color: surface.text, bold: true, margin: 0, breakLine: false,
  });
  if (spec.takeaway && layout !== "statement") {
    slide.addText(spec.takeaway, {
      x: contentX, y: 2.32, w: contentW - 0.3, h: 0.62, fontFace: font, fontSize: 15,
      color: surface.soft, margin: 0, breakLine: false,
    });
  }

  if (halfBleed) {
    if (spec.bullets.length > 0) {
      addBulletBlock(slide, spec.bullets, surface, theme.accent, font, { x: contentX + 0.05, y: 3.2, w: 6.1, h: 3.4 }, 14.5);
    }
  } else if (layout === "statement") {
    slide.addText(spec.takeaway || spec.title, {
      x: 0.9, y: 2.5, w: 10.9, h: spec.bullets.length > 0 ? 1.5 : 2.2, fontFace: font,
      fontSize: 27, color: theme.accent === surface.bg ? surface.text : theme.accent, bold: true, valign: "mid", margin: 0,
    });
    if (spec.bullets.length > 0) {
      addBulletBlock(slide, spec.bullets, surface, theme.accent, font, { x: 0.95, y: 4.35, w: 10.8, h: 2.3 }, 14.5, 8);
    }
  } else if (layout === "chart_focus") {
    addNativeChart(pptx, slide, spec, surface, theme, font);
  } else if (layout === "diagram_flow") {
    addNativeDiagram(pptx, slide, spec, surface, theme, font);
  } else if (layout === "timeline") {
    addTimeline(pptx, slide, spec, surface, theme, font);
  } else if (layout === "spatial_map") {
    addSpatialMap(pptx, slide, spec, surface, theme, font);
  } else if (layout === "steps" && spec.bullets.length > 0) {
    // Numbered flow: an accent chip per step, label bolded — the diagram-like
    // rhythm audiences read as intentional design.
    const rows = spec.bullets.slice(0, 4);
    const rowHeight = Math.min(1.0, 3.7 / rows.length);
    rows.forEach((bullet, rowIndex) => {
      const y = 3.15 + rowIndex * rowHeight;
      slide.addShape(pptx.ShapeType.roundRect, {
        x: 0.92, y: y + 0.02, w: 0.52, h: 0.42, rectRadius: 0.09,
        fill: { color: theme.accent }, line: { color: theme.accent, width: 0 },
      });
      slide.addText(String(rowIndex + 1).padStart(2, "0"), {
        x: 0.92, y: y + 0.02, w: 0.52, h: 0.42, align: "center", fontFace: MONO,
        fontSize: 13, bold: true, color: theme.accentInk, margin: 0, valign: "mid",
      });
      const match = bullet.match(/^(.{1,26}?)\s*(?:—|–|:)\s+(.+)$/);
      slide.addText(match
        ? [
          { text: `${match[1]}  `, options: { bold: true, color: surface.text, fontSize: 15.5 } },
          { text: match[2]!, options: { color: surface.soft, fontSize: 15.5 } },
        ]
        : [{ text: bullet, options: { color: surface.soft, fontSize: 15.5 } }], {
        x: 1.66, y, w: 10.3, h: rowHeight, fontFace: font, margin: 0, valign: "top",
      });
    });
  } else if (layout === "split" && spec.bullets.length > 0) {
    const midpoint = Math.ceil(spec.bullets.length / 2);
    [spec.bullets.slice(0, midpoint), spec.bullets.slice(midpoint)].forEach((items, column) => {
      if (items.length === 0) return;
      const x = 0.9 + column * 6.0;
      slide.addShape(pptx.ShapeType.roundRect, {
        x, y: 3.1, w: 5.55, h: 3.2, rectRadius: 0.09,
        fill: { color: surface.panel }, line: { color: surface.line, width: 1 },
      });
      addBulletBlock(slide, items, surface, theme.accent, font, { x: x + 0.32, y: 3.4, w: 4.95, h: 2.7 }, 14, 9);
    });
  } else if (layout === "evidence_focus" && spec.bullets.length > 0) {
    slide.addShape(pptx.ShapeType.line, {
      x: 0.94, y: 3.25, w: 0, h: Math.min(2.9, 0.7 * spec.bullets.length + 0.4),
      line: { color: theme.accent, width: 3.5 },
    });
    addBulletBlock(slide, spec.bullets, surface, theme.accent, font, { x: 1.3, y: 3.2, w: 10.6, h: 3.1 }, 15.5, 12);
  } else if (spec.stats.length > 0) {
    const width = Math.min(3.7, 11.4 / spec.stats.length);
    spec.stats.forEach((stat, statIndex) => {
      const x = 0.9 + statIndex * (width + 0.22);
      slide.addShape(pptx.ShapeType.roundRect, { x, y: 3.2, w: width, h: 2.1, rectRadius: 0.09, line: { color: surface.line, width: 1 }, fill: { color: surface.panel } });
      slide.addText(stat.value, { x: x + 0.24, y: 3.5, w: width - 0.48, h: 0.85, fontFace: font, fontSize: 34, bold: true, color: theme.accent === surface.bg ? surface.text : theme.accent, margin: 0 });
      slide.addText(stat.label, { x: x + 0.24, y: 4.45, w: width - 0.48, h: 0.55, fontFace: font, fontSize: 13.5, color: surface.soft, margin: 0 });
    });
  } else if (spec.bullets.length > 0) {
    addBulletBlock(slide, spec.bullets, surface, theme.accent, font, { x: 0.95, y: 3.2, w: 10.8, h: 3.1 }, 15.5, 12);
  }
  if (["image_focus", "image_left"].includes(layout) && !halfBleed && spec.image) {
    addPanelImage(pptx, slide, spec, surface, { x: 7.6, y: 2.7, w: 4.9, h: 3.6 });
  }
  addCitations(slide, spec, surface);
}

function speakerNotes(spec: SlideSpec): string {
  const sourceLines = spec.citations.length > 0
    ? spec.citations.map((citation) => `- ${citation.url} — ${citation.title}`)
    : ["- No external source used on this slide."];
  const imageLines = spec.image
    ? [
      "", "[Image]", `- ${spec.image.attributionText}`,
      `- Creator: ${spec.image.creatorUrl ?? "not provided"}`,
      `- Source: ${spec.image.sourcePageUrl ?? "User-provided local image"}`,
      "[/Image]",
    ]
    : [];
  const generatedVisualLines = spec.visualDirective.visualAssetType === "chart"
    ? ["", "[Visual]", "- Native PowerPoint chart generated from this slide's validated stats.", "- Data provenance: user brief / NarrativeSpec only.", "[/Visual]"]
    : spec.visualDirective.visualAssetType === "diagram"
      ? ["", "[Visual]", "- Native PowerPoint diagram generated from this slide's validated bullets.", "- Content provenance: user brief / NarrativeSpec only.", "[/Visual]"]
      : [];
  return [
    spec.notes || "No presenter notes provided.",
    "",
    "[Sources]",
    ...sourceLines,
    "[/Sources]",
    ...imageLines,
    ...generatedVisualLines,
  ].join("\n");
}

async function verifyDeckImages(deck: DeckSpec): Promise<void> {
  for (const slide of deck.slides) {
    if (!slide.image) continue;
    const localPath = resolvedImagePath(slide);
    if (!localPath) throw new Error(`Unsafe image path on slide ${slide.id}.`);
    const buffer = await readFile(localPath);
    const sha256 = createHash("sha256").update(buffer).digest("hex");
    if (sha256 !== slide.image.sha256) throw new Error(`Image hash mismatch on slide ${slide.id}; rendering was stopped.`);
  }
}

export async function renderDeck(deck: DeckSpec): Promise<DeckArtifact> {
  await verifyDeckImages(deck);
  const pptx = new PptxGenJS();
  const theme = themeSpec(deck.aestheticIntent.theme);
  pptx.layout = "LAYOUT_WIDE";
  pptx.author = "DeckForge X";
  pptx.subject = deck.thesis;
  pptx.title = deck.title;
  pptx.lang = deck.language === "ko" ? "ko-KR" : "en-US";
  pptx.theme = {
    headFontFace: bodyFont(deck),
    bodyFontFace: bodyFont(deck),
    lang: deck.language === "ko" ? "ko-KR" : "en-US",
  };

  deck.slides.forEach((spec, index) => {
    const slide = pptx.addSlide();
    const isCover = spec.archetype === "title" || spec.archetype === "closing";
    const surface = isCover ? theme.cover : theme.body;
    slide.background = { color: surface.bg };
    addPageMarker(slide, index, deck.slides.length, surface);
    if (spec.archetype === "title") addTitleSlide(pptx, slide, deck, spec, theme);
    else if (spec.archetype === "closing") addClosingSlide(pptx, slide, deck, spec, theme);
    else addContentSlide(pptx, slide, deck, spec, theme, index);
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
