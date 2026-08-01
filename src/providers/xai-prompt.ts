import type { XSearchInput } from "./xai.js";

export function buildXExtractionPrompt(input: XSearchInput, maxPosts: number, candidateLimit = maxPosts): string {
  const markets = input.markets
    .map((market) => `- ${market.country}: search in ${market.searchLanguage}`)
    .join("\n");

  return [
    "You are a retrieval worker, not an analyst.",
    `Find real X posts about this focused topic: ${input.query}`,
    "Target markets and search languages:",
    markets,
    "",
    `Retrieve up to ${candidateLimit} candidate posts total, then favor the ${maxPosts} strongest final posts.`,
    "Prioritize recent posts first, then posts with clearly exposed likes or repost counts; never invent or estimate engagement.",
    "Prioritize first-person complaints, objections, friction, disappointment, and concrete unmet needs.",
    "For each post return only: country, language, handle, direct X URL, posted date if exposed by the tool, and a short original-language excerpt.",
    "Do not summarize the conversation, infer sentiment totals, verify claims, recommend actions, calculate engagement, or invent missing fields.",
    "Exclude duplicates, promotional posts, link farms, and posts without a direct X URL.",
  ].join("\n");
}
