import JSZip from "jszip";

// Turns an uploaded PPTX into a text outline the pipeline can revise: the
// extracted content becomes part of the user's brief, so the existing team
// (narrative from brief → art direction → compose → critique) redesigns the
// deck instead of needing a separate revision pipeline.

export interface PptxOutline {
  slideCount: number;
  slides: Array<{ index: number; lines: string[] }>;
}

const MAX_SLIDES = 40;
const MAX_LINE_CHARS = 300;
const MAX_TOTAL_CHARS = 6000;

function decodeXml(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&#x27;|&apos;/gi, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(Number.parseInt(dec, 10)));
}

// One line per <a:p> paragraph; runs inside a paragraph are joined without
// separators, matching how PowerPoint displays them.
function slideTextLines(xml: string): string[] {
  const lines: string[] = [];
  for (const paragraph of xml.split(/<a:p[ >]/).slice(1)) {
    const runs = [...paragraph.matchAll(/<a:t(?:\s[^>]*)?>([\s\S]*?)<\/a:t>/g)].map((match) => decodeXml(match[1] ?? ""));
    const line = runs.join("").replace(/\s+/g, " ").trim();
    if (line.length > 0) lines.push(line.slice(0, MAX_LINE_CHARS));
  }
  return lines;
}

export async function extractPptxOutline(buffer: Buffer): Promise<PptxOutline> {
  const zip = await JSZip.loadAsync(buffer);
  const slideFiles = Object.keys(zip.files)
    .map((name) => {
      const match = name.match(/^ppt\/slides\/slide(\d+)\.xml$/);
      return match ? { name, index: Number.parseInt(match[1]!, 10) } : null;
    })
    .filter((entry): entry is { name: string; index: number } => entry !== null)
    .sort((left, right) => left.index - right.index)
    .slice(0, MAX_SLIDES);
  if (slideFiles.length === 0) {
    throw new Error("PPTX에서 슬라이드를 찾지 못했습니다. 올바른 .pptx 파일인지 확인하세요.");
  }

  const slides: PptxOutline["slides"] = [];
  let totalChars = 0;
  for (const file of slideFiles) {
    const xml = await zip.files[file.name]!.async("string");
    const lines: string[] = [];
    for (const line of slideTextLines(xml)) {
      if (totalChars + line.length > MAX_TOTAL_CHARS) break;
      totalChars += line.length;
      lines.push(line);
    }
    slides.push({ index: file.index, lines });
    if (totalChars >= MAX_TOTAL_CHARS) break;
  }
  return { slideCount: slideFiles.length, slides };
}

export function pptxOutlineToBrief(outline: PptxOutline, filename: string): string {
  const sections = outline.slides.map((slide) => {
    const body = slide.lines.length > 0 ? slide.lines.map((line) => `- ${line}`).join("\n") : "- (텍스트 없음)";
    return `## 슬라이드 ${slide.index}\n${body}`;
  });
  return [
    `[첨부 PPTX: ${filename} — 슬라이드 ${outline.slideCount}장의 기존 내용]`,
    "아래 기존 슬라이드 내용을 바탕으로 발표 자료를 다시 설계·수정한다.",
    ...sections,
  ].join("\n\n");
}
