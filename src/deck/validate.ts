import { deckSchema, type DeckSpec, type SlideSpec } from "./schema.js";

export type IssueSeverity = "error" | "warning";

export interface DeckIssue {
  code: string;
  severity: IssueSeverity;
  slideId: string | null;
  message: string;
}

const FIGURE = /(?:\d[\d,.]*\s*(?:%|퍼센트|배|명|건|회|원|달러|시간|분|일|주|개월|년))|(?:\b\d+(?:\.\d+)?\b)/u;

function visibleText(slide: SlideSpec): string {
  return [
    slide.title,
    slide.takeaway,
    ...slide.bullets,
    ...slide.stats.flatMap((stat) => [stat.value, stat.label]),
  ].join(" ");
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
    if (index === deck.slides.length - 1 && slide.archetype !== "closing") {
      issues.push({ code: "LAST_NOT_CLOSING", severity: "error", slideId: slide.id, message: "마지막 장은 closing이어야 합니다." });
    }
    if (!["title", "closing"].includes(slide.archetype) && slide.takeaway.trim().length === 0) {
      issues.push({ code: "NO_TAKEAWAY", severity: "error", slideId: slide.id, message: "본문 슬라이드에는 검증 가능한 takeaway가 필요합니다." });
    }
    if (slide.title.length > 58) {
      issues.push({ code: "TITLE_DENSE", severity: "warning", slideId: slide.id, message: "제목이 화면 발표용으로 깁니다." });
    }
    if (slide.bullets.length > 4) {
      issues.push({ code: "TOO_DENSE", severity: "warning", slideId: slide.id, message: "불릿은 4개 이하를 권장합니다." });
    }
    if (FIGURE.test(visibleText(slide)) && slide.citations.length === 0) {
      issues.push({ code: "UNGROUNDED_FIGURE", severity: "error", slideId: slide.id, message: "수치가 있지만 X 출처 URL이 없습니다." });
    }
    for (const citation of slide.citations) {
      const host = new URL(citation.url).hostname.toLocaleLowerCase();
      if (!host.endsWith("x.com") && !host.endsWith("twitter.com")) {
        issues.push({ code: "NON_X_SOURCE", severity: "warning", slideId: slide.id, message: `X 검색 결과가 아닌 출처입니다: ${citation.url}` });
      }
    }
  }

  return { deck, issues };
}

export function fatalIssues(issues: DeckIssue[]): DeckIssue[] {
  return issues.filter((issue) => issue.severity === "error");
}

