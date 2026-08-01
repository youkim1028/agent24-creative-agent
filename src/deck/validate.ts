import {
  deckSchema,
  visualDirectiveContractIssues,
  visualSilhouetteKey,
  type DeckSpec,
} from "./schema.js";

export type IssueSeverity = "error" | "warning";

export interface DeckIssue {
  code: string;
  severity: IssueSeverity;
  slideId: string | null;
  message: string;
}

function numericStatValue(value: string): number | null {
  const normalized = value.replace(/,/g, "").match(/-?\d+(?:\.\d+)?/u)?.[0];
  if (!normalized) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

export function validateDeck(input: unknown): { deck: DeckSpec | null; issues: DeckIssue[] } {
  const parsed = deckSchema.safeParse(input);
  if (!parsed.success) {
    return {
      deck: null,
      issues: parsed.error.issues.map((issue) => ({
        code: "SCHEMA",
        severity: "error" as const,
        slideId: null,
        message: `${issue.path.join(".") || "deck"}: ${issue.message}`,
      })),
    };
  }

  const deck = parsed.data;
  const issues: DeckIssue[] = [];
  const ids = new Set<string>();

  for (const [index, slide] of deck.slides.entries()) {
    if (ids.has(slide.id)) {
      issues.push({ code: "DUPLICATE_ID", severity: "error", slideId: slide.id, message: "슬라이드 id가 중복됩니다." });
    }
    ids.add(slide.id);

    if (index === 0 && slide.archetype !== "title") {
      issues.push({ code: "FIRST_NOT_TITLE", severity: "error", slideId: slide.id, message: "첫 장은 title이어야 합니다." });
    }
    if (index === 0 && slide.visualDirective.layout !== "hero") {
      issues.push({ code: "TITLE_LAYOUT", severity: "error", slideId: slide.id, message: "첫 장 visualDirective.layout은 hero여야 합니다." });
    }
    if (index === deck.slides.length - 1 && slide.archetype !== "closing") {
      issues.push({ code: "LAST_NOT_CLOSING", severity: "error", slideId: slide.id, message: "마지막 장은 closing이어야 합니다." });
    }
    if (index === deck.slides.length - 1 && slide.visualDirective.layout !== "statement") {
      issues.push({ code: "CLOSING_LAYOUT", severity: "error", slideId: slide.id, message: "마지막 장 visualDirective.layout은 statement여야 합니다." });
    }
    if (index > 0 && index < deck.slides.length - 1 && slide.visualDirective.layout === "hero") {
      issues.push({ code: "BODY_HERO_LAYOUT", severity: "error", slideId: slide.id, message: "hero 레이아웃은 표지에서만 지원됩니다." });
    }
    for (const issue of visualDirectiveContractIssues(slide.visualDirective)) {
      issues.push({ code: "VISUAL_INTENT_MISMATCH", severity: "error", slideId: slide.id, message: issue });
    }
    if (["split", "steps", "evidence_focus", "diagram_flow", "timeline", "spatial_map"].includes(slide.visualDirective.layout) && slide.bullets.length === 0) {
      issues.push({ code: "LAYOUT_INPUT_MISSING", severity: "error", slideId: slide.id, message: `${slide.visualDirective.layout} 레이아웃에는 표시할 불릿이 필요합니다.` });
    }
    if (["timeline", "spatial_map"].includes(slide.visualDirective.layout) && slide.bullets.length < 2) {
      issues.push({ code: "RELATIONSHIP_INPUT_MISSING", severity: "error", slideId: slide.id, message: `${slide.visualDirective.layout} requires at least two items.` });
    }
    if (slide.visualDirective.visualAssetType === "diagram" && slide.bullets.length < 2) {
      issues.push({ code: "DIAGRAM_INPUT_MISSING", severity: "error", slideId: slide.id, message: "구조도에는 최소 2개의 단계 또는 노드가 필요합니다." });
    }
    if (slide.visualDirective.visualAssetType === "diagram" && !["diagram_flow", "timeline", "spatial_map"].includes(slide.visualDirective.layout)) {
      issues.push({ code: "DIAGRAM_LAYOUT_MISMATCH", severity: "error", slideId: slide.id, message: "diagram 시각자료는 diagram_flow 레이아웃을 사용해야 합니다." });
    }
    if (["diagram_flow", "timeline", "spatial_map"].includes(slide.visualDirective.layout) && slide.visualDirective.visualAssetType !== "diagram") {
      issues.push({ code: "DIAGRAM_ASSET_MISMATCH", severity: "error", slideId: slide.id, message: "diagram_flow 레이아웃은 diagram 시각자료가 필요합니다." });
    }
    if (slide.visualDirective.visualAssetType === "chart") {
      if (slide.visualDirective.layout !== "chart_focus") {
        issues.push({ code: "CHART_LAYOUT_MISMATCH", severity: "error", slideId: slide.id, message: "chart 시각자료는 chart_focus 레이아웃을 사용해야 합니다." });
      }
      const numericStats = slide.stats.filter((stat) => numericStatValue(stat.value) !== null);
      if (numericStats.length < 2) {
        issues.push({ code: "CHART_INPUT_MISSING", severity: "error", slideId: slide.id, message: "차트에는 사용자 입력에서 가져온 숫자형 stats가 최소 2개 필요합니다." });
      }
    }
    if (slide.visualDirective.layout === "chart_focus" && slide.visualDirective.visualAssetType !== "chart") {
      issues.push({ code: "CHART_ASSET_MISMATCH", severity: "error", slideId: slide.id, message: "chart_focus 레이아웃은 chart 시각자료가 필요합니다." });
    }
    if (slide.visualDirective.imageNeed === "required" && !slide.image) {
      issues.push({ code: "REQUIRED_IMAGE_MISSING", severity: "error", slideId: slide.id, message: "필수 이미지가 이 슬라이드에 연결되지 않았습니다." });
    }
    const externalVisual = ["photo", "screenshot"].includes(slide.visualDirective.visualAssetType);
    if (externalVisual && slide.visualDirective.imageNeed === "none") {
      issues.push({ code: "VISUAL_ASSET_NEED_MISMATCH", severity: "error", slideId: slide.id, message: "사진과 스크린샷은 imageNeed가 optional 또는 required여야 합니다." });
    }
    if (!externalVisual && slide.visualDirective.imageNeed !== "none") {
      issues.push({ code: "VISUAL_ASSET_NEED_MISMATCH", severity: "error", slideId: slide.id, message: "사진과 스크린샷 외 시각자료는 외부 이미지를 요청할 수 없습니다." });
    }
    if (slide.visualDirective.imageNeed === "none" && slide.image) {
      issues.push({ code: "UNPLANNED_IMAGE", severity: "error", slideId: slide.id, message: "Art Director가 이미지 없음으로 지정한 슬라이드에 이미지가 연결되었습니다." });
    }
    if (!["photo", "screenshot"].includes(slide.visualDirective.visualAssetType) && slide.image) {
      issues.push({ code: "VISUAL_ASSET_IMAGE_MISMATCH", severity: "error", slideId: slide.id, message: "사진 또는 스크린샷이 아닌 시각자료에 이미지 파일이 연결되었습니다." });
    }
    if (["image_focus", "image_left"].includes(slide.visualDirective.layout) && !slide.image) {
      issues.push({ code: "IMAGE_FOCUS_FALLBACK", severity: "warning", slideId: slide.id, message: "선택된 이미지가 없어 image_focus가 텍스트 폴백으로 렌더링됩니다." });
    }
    if (["image_focus", "image_left"].includes(slide.visualDirective.layout) && !externalVisual) {
      issues.push({ code: "IMAGE_ASSET_MISMATCH", severity: "error", slideId: slide.id, message: "image_focus 레이아웃은 photo 또는 screenshot 시각자료가 필요합니다." });
    }
    if (slide.image && slide.image.slideId !== slide.id) {
      issues.push({ code: "IMAGE_SLIDE_MISMATCH", severity: "error", slideId: slide.id, message: "선택 이미지의 slideId가 현재 슬라이드와 다릅니다." });
    }
    if (!["title", "closing"].includes(slide.archetype) && slide.takeaway.trim().length === 0) {
      issues.push({ code: "NO_TAKEAWAY", severity: "error", slideId: slide.id, message: "본문 슬라이드에는 검증 가능한 takeaway가 필요합니다." });
    }
    if (slide.title.length > 58) {
      issues.push({ code: "TITLE_DENSE", severity: "warning", slideId: slide.id, message: "제목이 화면 발표용으로 깁니다." });
    }
    // 서술형 종결 제목("~한다/~됩니다")은 한국어 발표 문화에서 대표적인 AI 생성 티다.
    // 제목은 명사구·구호형으로, 서술은 takeaway가 담당한다.
    if (deck.language === "ko" && /(한다|된다|이다|한다|합니다|됩니다|입니다|습니다)\s*[.!]?$/u.test(slide.title.trim())) {
      issues.push({ code: "KO_SENTENCE_TITLE", severity: "warning", slideId: slide.id, message: "한국어 제목이 서술형 문장으로 끝납니다. 명사구·구호형 제목으로 바꾸고 서술은 takeaway로 옮기세요." });
    }
    if (slide.bullets.length > 4) {
      issues.push({ code: "TOO_DENSE", severity: "warning", slideId: slide.id, message: "불릿은 4개 이하를 권장합니다." });
    }
  }

  deck.slides.forEach((slide, index) => {
    if (index === 0) return;
    const previous = deck.slides[index - 1]!;
    if (visualSilhouetteKey(previous.visualDirective) === visualSilhouetteKey(slide.visualDirective)) {
      issues.push({
        code: "ADJACENT_SILHOUETTE_REPEAT",
        severity: "error",
        slideId: slide.id,
        message: `Adjacent slides ${previous.id} and ${slide.id} repeat the same silhouette.`,
      });
    }
  });
  if (deck.slides.length === 5) {
    const seenFamilies = new Set<string>();
    for (const slide of deck.slides) {
      if (seenFamilies.has(slide.visualDirective.layoutFamily)) {
        issues.push({
          code: "LAYOUT_FAMILY_REPEAT",
          severity: "error",
          slideId: slide.id,
          message: `A five-slide deck may use layoutFamily=${slide.visualDirective.layoutFamily} only once.`,
        });
      }
      seenFamilies.add(slide.visualDirective.layoutFamily);
    }
  }

  return { deck, issues };
}

export function fatalIssues(issues: DeckIssue[]): DeckIssue[] {
  return issues.filter((issue) => issue.severity === "error");
}
