import { createHash } from "node:crypto";
import { Storage } from "@google-cloud/storage";
import { z } from "zod";
import { config } from "../config.js";
import { citationSchema } from "../deck/schema.js";
import type { ResearchMarket } from "../research/markets.js";

const recordSchema = z.object({
  version: z.literal(1),
  collectedAt: z.string().datetime(),
  expiresAt: z.string().datetime(),
  markets: z.array(z.object({ country: z.string(), searchLanguage: z.string() })).max(3),
  extract: z.string().max(6000),
  citations: z.array(citationSchema).max(8),
});

export type ResearchMemoryRecord = z.infer<typeof recordSchema>;

export interface ResearchMemoryIdentity {
  query: string;
  markets: ResearchMarket[];
  maxPosts: number;
  fromDate: string | null;
  toDate: string | null;
  allowedHandles: string[];
}

function objectName(input: ResearchMemoryIdentity): string {
  const identity = JSON.stringify({
    version: 1,
    query: input.query.trim().toLocaleLowerCase(),
    markets: input.markets,
    maxPosts: input.maxPosts,
    fromDate: input.fromDate,
    toDate: input.toDate,
    allowedHandles: [...input.allowedHandles].map((handle) => handle.toLocaleLowerCase()).sort(),
  });
  const hash = createHash("sha256").update(identity).digest("hex");
  return `${config.gcsPrefix}/${hash}.json`;
}

function storageClient(): Storage {
  return new Storage(config.gcsProjectId ? { projectId: config.gcsProjectId } : undefined);
}

export async function loadResearchMemory(
  input: ResearchMemoryIdentity,
): Promise<{ record: ResearchMemoryRecord | null; warning: string | null }> {
  if (!config.gcsMemoryEnabled || !config.gcsBucket) return { record: null, warning: null };
  try {
    const [bytes] = await storageClient().bucket(config.gcsBucket).file(objectName(input)).download();
    const record = recordSchema.parse(JSON.parse(bytes.toString("utf8")));
    if (Date.parse(record.expiresAt) <= Date.now()) return { record: null, warning: null };
    return { record, warning: null };
  } catch (error) {
    const code = typeof error === "object" && error && "code" in error ? String((error as { code: unknown }).code) : "";
    if (code === "404") return { record: null, warning: null };
    const message = error instanceof Error ? error.message : "Unknown GCS read failure";
    return { record: null, warning: `GCS cache read skipped: ${message}` };
  }
}

export async function saveResearchMemory(
  input: ResearchMemoryIdentity,
  value: Pick<ResearchMemoryRecord, "extract" | "citations">,
): Promise<string | null> {
  if (!config.gcsMemoryEnabled || !config.gcsBucket) return null;
  const collectedAt = new Date();
  const record: ResearchMemoryRecord = {
    version: 1,
    collectedAt: collectedAt.toISOString(),
    expiresAt: new Date(collectedAt.getTime() + config.gcsCacheTtlHours * 60 * 60 * 1000).toISOString(),
    markets: input.markets,
    extract: value.extract.slice(0, 6000),
    citations: value.citations.slice(0, input.maxPosts),
  };
  try {
    await storageClient().bucket(config.gcsBucket).file(objectName(input)).save(JSON.stringify(record), {
      resumable: false,
      contentType: "application/json",
      metadata: { cacheControl: "private, no-store" },
    });
    return null;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown GCS write failure";
    return `GCS cache write skipped: ${message}`;
  }
}
