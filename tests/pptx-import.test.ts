import { describe, expect, it } from "vitest";
import PptxGenModule from "pptxgenjs";
import { extractPptxOutline, pptxOutlineToBrief } from "../src/deck/pptx-import.js";

const PptxGenJS = ((PptxGenModule as any).default ?? PptxGenModule) as new () => any;

describe("pptx import for revision briefs", () => {
  it("extracts per-slide text lines and formats a revision brief", async () => {
    const pptx = new PptxGenJS();
    pptx.addSlide().addText("첫 슬라이드 제목 & 부제", { x: 1, y: 1, w: 6, h: 1 });
    const second = pptx.addSlide();
    second.addText([
      { text: "불릿 A", options: { breakLine: true } },
      { text: "불릿 B", options: {} },
    ], { x: 1, y: 1, w: 6, h: 2 });
    const buffer = (await pptx.write({ outputType: "nodebuffer" })) as Buffer;

    const outline = await extractPptxOutline(buffer);
    expect(outline.slideCount).toBe(2);
    expect(outline.slides[0]?.lines).toContain("첫 슬라이드 제목 & 부제");

    const brief = pptxOutlineToBrief(outline, "old-deck.pptx");
    expect(brief).toContain("old-deck.pptx");
    expect(brief).toContain("## 슬라이드 1");
    expect(brief).toContain("불릿 A");
    expect(brief).toContain("다시 설계·수정");
  });

  it("rejects a non-pptx buffer with a clear error", async () => {
    await expect(extractPptxOutline(Buffer.from("not a zip"))).rejects.toThrow();
  });
});
