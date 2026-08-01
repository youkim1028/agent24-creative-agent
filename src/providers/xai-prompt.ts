import type { XSearchInput } from "./xai.js";

export function buildXExtractionPrompt(input: XSearchInput, maxPosts: number, candidateLimit = maxPosts): string {
  const markets = input.markets
    .map((market) => `- ${market.country}: search in ${market.searchLanguage}`)
    .join("\n");

  return [
    "You are a retrieval worker, not an analyst.",
    `Research lane: ${input.lane}. Keep evidence from this lane separate from other research jobs.`,
    `Find real X posts about this focused topic: ${input.query}`,
    "Target markets and search languages:",
    markets,
    "",
    `Retrieve up to ${candidateLimit} candidate posts total, then favor the ${maxPosts} strongest final posts.`,
    "Prioritize recent posts first, then posts with clearly exposed likes or repost counts; never invent or estimate engagement.",
    "Prioritize first-person complaints, objections, friction, disappointment, and concrete unmet needs.",
    "Do not summarize the conversation, infer sentiment totals, verify claims, recommend actions, calculate engagement, or invent missing fields.",
    "Exclude duplicates, promotional posts, link farms, and posts without a direct X URL.",
    "",
    "Output format: return ONLY a JSON array, with no markdown fences and no prose before or after it.",
    "Each element must be an object with exactly these keys:",
    '{"country":"...","language":"...","handle":"@user","url":"https://x.com/<user>/status/<id>","postedAt":"ISO 8601 date or null","excerpt":"short original-language excerpt","likes":number or null,"reposts":number or null}',
    "Use the author's direct status URL, never an https://x.com/i/status/... shortcut. Set a field to null when the tool did not expose it.",
  ].join("\n");
}
