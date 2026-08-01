import { evaluateDeck } from "../dist/deck/evaluate.js";
import { renderDeck } from "../dist/deck/render.js";
import { fatalIssues, validateDeck } from "../dist/deck/validate.js";

const citation = {
  url: "https://www.youtube.com/watch?v=demo123&lc=comment456",
  title: "Community design critique",
  handle: "demo_user",
  excerpt: "The repeated card layout makes every AI deck feel interchangeable.",
  country: "United States",
  language: "en",
  postedAt: "2026-07-25T12:00:00.000Z",
  engagement: { likes: null, reposts: null, score: 42, comments: 11 },
};

const directiveMetadata = {
  hero: { layoutFamily: "opening_hero", dominantVisual: "headline", informationShape: "declaration" },
  evidence_focus: { layoutFamily: "evidence_list", dominantVisual: "evidence", informationShape: "evidence" },
  chart_focus: { layoutFamily: "data_chart", dominantVisual: "data", informationShape: "comparison" },
  diagram_flow: { layoutFamily: "process_diagram", dominantVisual: "relationship", informationShape: "sequence" },
  statement: { layoutFamily: "closing_statement", dominantVisual: "headline", informationShape: "synthesis" },
};

const directive = (layout, composition, emphasis, visualAssetType = "none") => ({
  layout,
  ...directiveMetadata[layout],
  composition,
  visualAssetType,
  imageNeed: "none",
  emphasis,
  avoid: ["decorative AI imagery"],
});

const deck = {
  title: "검색 신호가 설계 결정을 바꾸는 순간",
  subtitle: "X·YouTube·Hacker News 근거를 6-Agent 팀이 검증 가능한 발표로 연결한다",
  audience: "해커톤 심사위원",
  thesis: "검색 근거와 아트 디렉션이 같은 계약을 통과해야 렌더한다.",
  language: "ko",
  aestheticIntent: {
    theme: "ink_acid",
    rationale: "근거 중심 심사를 위해 높은 대비와 서로 다른 레이아웃 실루엣을 사용한다.",
    mood: "집중되고 분석적",
    layoutLogic: "주장마다 하나의 시각 구조를 사용한다.",
    imageLogic: "검색되지 않은 이미지는 사용하지 않는다.",
    avoid: ["반복 카드", "장식 아이콘"],
    emblem: { kind: "concentric_rings", rationale: "레이어를 쌓아 판정하는 파이프라인의 구조를 반향한다." },
  },
  slides: [
    {
      id: "title", archetype: "title", visualRole: "declaration",
      visualDirective: directive("hero", "왼쪽 정렬 선언", "제목"),
      eyebrow: "DECKFORGE X", title: "검색 신호가 설계 결정을 바꾸는 순간", takeaway: "",
      bullets: [], stats: [], notes: "오프닝", citations: [],
    },
    {
      id: "evidence", archetype: "claim", visualRole: "evidence",
      visualDirective: directive("evidence_focus", "인용 중심", "커뮤니티 문장"),
      eyebrow: "EVIDENCE", title: "반복 레이아웃은 신뢰보다 피로를 만든다",
      takeaway: "디자인 비판 레인을 분리하면 피해야 할 표현이 구체화된다.",
      bullets: ["출처 단위 보존"], stats: [], notes: "대화의 증거", citations: [citation],
    },
    {
      id: "contrast", archetype: "two_col", visualRole: "explanation",
      visualDirective: directive("chart_focus", "심사 비중 비교", "상위 평가 기준", "chart"),
      eyebrow: "JUDGING", title: "아키텍처와 적응력이 절반을 결정한다",
      takeaway: "가장 큰 두 평가 기준은 라이브 추적과 복구 흐름으로 증명한다.",
      bullets: [],
      stats: [{ value: "25%", label: "Pipeline Architecture" }, { value: "25%", label: "Adaptability" }, { value: "20%", label: "Prompt Quality" }],
      notes: "제공된 심사 기준", citations: [citation],
    },
    {
      id: "flow", archetype: "process", visualRole: "action",
      visualDirective: directive("diagram_flow", "연결형 흐름", "검증 순서", "diagram"),
      eyebrow: "PIPELINE", title: "여섯 역할은 계약으로만 연결된다",
      takeaway: "각 단계의 출력이 다음 단계 입력과 코드 게이트가 된다.",
      bullets: ["계획", "근거", "서사", "아트·구성"], stats: [], notes: "핸드오프", citations: [citation],
    },
    {
      id: "close", archetype: "closing", visualRole: "synthesis",
      visualDirective: directive("statement", "한 문장 결론", "행동"),
      eyebrow: "DECISION", title: "검증된 같은 DeckSpec만 렌더한다",
      takeaway: "검색·판단·표현의 책임을 분리하면 즉석 입력에도 실패 지점이 보인다.",
      bullets: [], stats: [], notes: "마무리", citations: [citation],
    },
  ],
};

const validation = validateDeck(deck);
const evaluation = validation.deck ? evaluateDeck(validation.deck) : null;
if (!validation.deck || fatalIssues(validation.issues).length > 0 || !evaluation?.ready) {
  throw new Error(JSON.stringify({ issues: validation.issues, evaluation }, null, 2));
}

const artifact = await renderDeck(validation.deck);
console.log(JSON.stringify({ artifact, evaluation }, null, 2));
