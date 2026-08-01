export interface ResearchMarket {
  country: string;
  searchLanguage: string;
}

const DEFAULT_MARKETS: Record<"ko" | "en", ResearchMarket[]> = {
  ko: [
    { country: "South Korea", searchLanguage: "ko" },
    { country: "United States", searchLanguage: "en" },
  ],
  en: [
    { country: "United States", searchLanguage: "en" },
    { country: "United Kingdom", searchLanguage: "en" },
  ],
};

const COUNTRY_LANGUAGES: Record<string, string> = {
  "south korea": "ko",
  korea: "ko",
  한국: "ko",
  대한민국: "ko",
  japan: "ja",
  일본: "ja",
  china: "zh",
  중국: "zh",
  "united states": "en",
  usa: "en",
  미국: "en",
  "united kingdom": "en",
  uk: "en",
  영국: "en",
  canada: "en",
  캐나다: "en",
  australia: "en",
  호주: "en",
  india: "en",
  인도: "en",
  france: "fr",
  프랑스: "fr",
  germany: "de",
  독일: "de",
};

export function resolveResearchMarkets(language: "ko" | "en", requested: string[]): ResearchMarket[] {
  const cleaned = requested
    .map((country) => country.trim().slice(0, 60))
    .filter(Boolean)
    .filter((country, index, values) => values.findIndex((value) => value.toLocaleLowerCase() === country.toLocaleLowerCase()) === index)
    .slice(0, 3);

  if (cleaned.length === 0) return DEFAULT_MARKETS[language];
  return cleaned.map((country) => ({
    country,
    searchLanguage: COUNTRY_LANGUAGES[country.toLocaleLowerCase()] ?? language,
  }));
}
