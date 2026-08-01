import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

// Design fingerprints of the most recent successful decks. The Art Director
// receives these so consecutive runs read as different designers' work instead
// of one template: same brief, different theme/emblem/layout rhythm each run.
export interface RecentDesignFingerprint {
  theme: string;
  emblem: string | null;
  layoutSequence: string[];
}

export async function collectRecentDesigns(limit = 3): Promise<RecentDesignFingerprint[]> {
  try {
    const directory = path.resolve("artifacts");
    const names = (await readdir(directory)).filter((name) => name.endsWith(".json"));
    const dated = await Promise.all(names.map(async (name) => ({
      name,
      mtime: (await stat(path.join(directory, name))).mtimeMs,
    })));
    dated.sort((a, b) => b.mtime - a.mtime);

    const fingerprints: RecentDesignFingerprint[] = [];
    for (const { name } of dated) {
      if (fingerprints.length >= limit) break;
      try {
        const parsed = JSON.parse(await readFile(path.join(directory, name), "utf8")) as {
          aestheticIntent?: { theme?: unknown; emblem?: { kind?: unknown } | null };
          slides?: Array<{ visualDirective?: { layout?: unknown } }>;
        };
        const theme = parsed.aestheticIntent?.theme;
        if (typeof theme !== "string") continue;
        const emblemKind = parsed.aestheticIntent?.emblem?.kind;
        fingerprints.push({
          theme,
          emblem: typeof emblemKind === "string" ? emblemKind : null,
          layoutSequence: (parsed.slides ?? [])
            .map((slide) => slide.visualDirective?.layout)
            .filter((layout): layout is string => typeof layout === "string"),
        });
      } catch {
        // Unreadable or pre-contract artifact JSON — skip it.
      }
    }
    return fingerprints;
  } catch {
    return [];
  }
}
