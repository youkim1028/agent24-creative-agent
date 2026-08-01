// Deterministic complaint-signal heuristic for retrieval ranking. Both research
// lanes exist to surface complaints, criticism, and AI-cliche fatigue, but raw
// popularity ranking surfaces praise ("thank you, awesome video!") because that
// is what gets liked. This scorer keeps retrieval code deterministic and
// explainable: it counts complaint/critique markers, zeroes out pure praise,
// and damps ultra-short low-information comments. Semantic judgment still
// belongs to the Evidence Analyst downstream.

const COMPLAINT_MARKERS = [
  // English: friction, quality, and AI-slop vocabulary.
  "problem", "issue", "bug", "hate", "suck", "terrible", "awful", "bad", "worse", "worst",
  "ugly", "generic", "bland", "boring", "repetitive", "identical", "cookie cutter", "cliche",
  "cliché", "slop", "soulless", "unreadable", "cluttered", "messy", "wrong", "error", "fail",
  "disappoint", "frustrat", "annoying", "useless", "waste", "broken", "can't", "cant",
  "doesn't", "don't work", "limited", "overpriced", "pricing", "scam", "redo", "fix",
  "struggle", "hallucinat", "made up", "same layout", "looks the same", "look the same",
  // Korean.
  "문제", "불만", "별로", "아쉽", "실망", "짜증", "촌스", "획일", "뻔하", "똑같", "반복",
  "어색", "이상하", "엉망", "가독성", "수정", "고치", "다시 만들", "느리", "안됨", "안 됨",
  "안돼", "오류", "에러", "틀리", "헛소리", "환각", "비싸", "아깝", "구리", "후지",
];

const PRAISE_MARKERS = [
  "thank", "great", "awesome", "amazing", "love", "perfect", "excellent", "helpful",
  "best video", "subscribed", "감사", "좋아요", "최고", "유익", "잘 봤", "구독", "응원",
];

// Keyword search matches ANY query token, so a generic word like "problem" pulls
// in popular-but-unrelated posts ("The AI tool discovery problem") that can never
// inform this deck's rubric. A candidate must share the query's SPECIFIC domain
// tokens (stemmed, generic filler words excluded) before it counts as relevant.
const GENERIC_QUERY_TOKENS = new Set([
  "problems", "problem", "issues", "issue", "with", "about", "when", "what", "best",
  "review", "reviews", "guide", "tips",
]);

export function isQueryRelevant(text: string, query: string, minMatches: number): boolean {
  const value = text.toLowerCase();
  const tokens = [...new Set(
    query.toLowerCase().split(/[^\p{L}\p{N}]+/u)
      .filter((token) => token.length >= 4 && !GENERIC_QUERY_TOKENS.has(token)),
  )];
  if (tokens.length === 0) return true;
  const required = Math.min(minMatches, tokens.length);
  const matches = tokens.filter((token) => value.includes(token.slice(0, Math.max(4, token.length - 2)))).length;
  return matches >= required;
}

// 0 = pure praise (never complaint evidence), 0.25 = neutral/unknown, up to 1 for
// clearly critical text. Short comments carry little signal either way.
export function complaintSignalScore(text: string): number {
  const value = text.toLowerCase();
  const complaints = COMPLAINT_MARKERS.filter((marker) => value.includes(marker)).length;
  const praises = PRAISE_MARKERS.filter((marker) => value.includes(marker)).length;
  const lengthFactor = value.trim().length >= 40 ? 1 : 0.5;
  if (complaints === 0) return praises > 0 ? 0 : 0.25 * lengthFactor;
  return Math.min(1, 0.55 + complaints * 0.15) * lengthFactor;
}
