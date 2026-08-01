import type { DeckSpec } from "./schema.js";

export interface DeckEvaluationIssue {
  code: string;
  severity: "warning" | "error";
  slideId: string | null;
  message: string;
}

export interface DeckEvaluation {
  score: number;
  ready: boolean;
  dimensions: {
    narrative: number;
    visualIntent: number;
    rhythm: number;
    grounding: number;
  };
  issues: DeckEvaluationIssue[];
  caveats: string[];
}

const GENERIC_TITLES = /^(background|overview|analysis|conclusion|introduction|summary|배경|개요|분석|결론|소개|요약)$/iu;

export function evaluateDeck(deck: DeckSpec): DeckEvaluation {
  const issues: DeckEvaluationIssue[] = [];
  const caveats: string[] = [
    "This is a deterministic structure review; visual taste and factual truth still require human judgment.",
  ];
  const bodySlides = deck.slides.slice(1, -1);
  const roles = new Set(bodySlides.map((slide) => slide.visualRole));

  let narrative = 100;
  let visualIntent = 100;
  let rhythm = 100;
  let grounding = 100;

  if (deck.slides[0]?.visualRole !== "declaration") {
    narrative -= 20;
    issues.push({ code: "OPENING_ROLE", severity: "warning", slideId: deck.slides[0]?.id ?? null, message: "The opening slide should declare the central direction." });
  }
  const closing = deck.slides.at(-1);
  if (closing && !["synthesis", "action"].includes(closing.visualRole)) {
    narrative -= 20;
    issues.push({ code: "CLOSING_ROLE", severity: "warning", slideId: closing.id, message: "The closing slide should synthesize the argument or state an action." });
  }
  if (bodySlides.length >= 2 && roles.size < 2) {
    rhythm -= 25;
    issues.push({ code: "ROLE_REPETITION", severity: "warning", slideId: null, message: "Body slides repeat one visual role; introduce a deliberate change in rhythm." });
  }
  if (deck.aestheticIntent.rationale.length < 32) {
    visualIntent -= 15;
    issues.push({ code: "THIN_AESTHETIC_RATIONALE", severity: "warning", slideId: null, message: "Explain why this visual direction serves the audience and topic." });
  }
  if (deck.aestheticIntent.avoid.length === 0) {
    visualIntent -= 10;
    issues.push({ code: "NO_CLICHE_GUARDRAILS", severity: "warning", slideId: null, message: "Name at least one visual cliche or treatment to avoid." });
  }
  for (const slide of deck.slides) {
    if (GENERIC_TITLES.test(slide.title.trim())) {
      narrative -= 8;
      issues.push({ code: "GENERIC_TITLE", severity: "warning", slideId: slide.id, message: "Use a claim or decision in the title instead of a topic label." });
    }
  }
  if (bodySlides.length > 0 && bodySlides.every((slide) => slide.citations.length === 0)) {
    grounding -= 20;
    issues.push({ code: "NO_BODY_SOURCES", severity: "warning", slideId: null, message: "No body slide cites a source; make the evidence boundary explicit." });
  }

  const score = Math.max(0, Math.round((narrative + visualIntent + rhythm + grounding) / 4));
  return {
    score,
    ready: score >= 70 && !issues.some((issue) => issue.severity === "error"),
    dimensions: { narrative, visualIntent, rhythm, grounding },
    issues,
    caveats,
  };
}
