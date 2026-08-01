import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { homedir } from "node:os";
import path from "node:path";

const cutoff = Date.parse("2026-08-01T14:00:00+09:00");
const requiredFiles = [
  "README.md",
  ".env.example",
  "src/agent/runner.ts",
  "src/agent/prompt.ts",
  "src/providers/xai.ts",
  "src/providers/xai-prompt.ts",
  "src/providers/youtube.ts",
  "src/providers/hacker-news.ts",
  "src/research/markets.ts",
  "src/memory/gcs-research.ts",
  "src/team/contracts.ts",
  "src/team/prompts.ts",
  "src/team/team-runner.ts",
  "src/images/image-service.ts",
  "src/images/quota-ledger.ts",
  "src/images/upload-registry.ts",
  "src/deck/render.ts",
  "public/trace.html",
  "docs/architecture.md",
  "docs/demo-script.md",
];

const checks = [];
const add = (name, ok, detail) => checks.push({ name, ok, detail });

const major = Number(process.versions.node.split(".")[0]);
add("Node.js >= 20", major >= 20, process.version);

const missing = requiredFiles.filter((file) => !existsSync(file));
add("required files", missing.length === 0, missing.length ? `missing: ${missing.join(", ")}` : "present");

if (existsSync(".git")) {
  const trackedEnv = spawnSync("git", ["ls-files", ".env"], { encoding: "utf8" }).stdout.trim();
  add(".env is not tracked", trackedEnv.length === 0, trackedEnv || "not tracked");

  const log = spawnSync("git", ["log", "--format=%H|%cI"], { encoding: "utf8" });
  const commits = log.stdout.trim().split(/\r?\n/).filter(Boolean);
  const early = commits.filter((line) => {
    const [, date] = line.split("|");
    return date && Date.parse(date) < cutoff;
  });
  add(
    "commits after 2026-08-01 14:00 KST",
    commits.length > 0 && early.length === 0,
    commits.length === 0 ? "no commits yet" : early.length ? `${early.length} early commit(s)` : `${commits.length} valid commit(s)`,
  );

  const grep = spawnSync("git", ["grep", "-nE", "(sk|xai)-[A-Za-z0-9_-]{20,}"], { encoding: "utf8" });
  add("no obvious API keys in tracked files", grep.status === 1, grep.stdout.trim() || "none found");
} else {
  add("Git repository", false, "run git init after the official start time");
}

if (existsSync(".env")) {
  const text = readFileSync(".env", "utf8");
  const hasOpenAIKey = /^OPENAI_API_KEY=\S+/m.test(text);
  const hasXaiKey = /^XAI_API_KEY=\S+/m.test(text);
  const hasYouTubeKey = /^YOUTUBE_API_KEY=\S+/m.test(text);
  const hasPexelsKey = /^PEXELS_API_KEY=\S+/m.test(text);
  const hasUnsplashKey = /^UNSPLASH_ACCESS_KEY=\S+/m.test(text);
  const gcsEnabled = /^GCS_MEMORY_ENABLED=true\s*$/im.test(text);
  const hasGcsBucket = /^GCS_BUCKET=\S+/m.test(text);
  const explicitAdc = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  const defaultAdc = process.platform === "win32"
    ? path.join(process.env.APPDATA || "", "gcloud", "application_default_credentials.json")
    : path.join(homedir(), ".config", "gcloud", "application_default_credentials.json");
  const hasLocalAdc = Boolean((explicitAdc && existsSync(explicitAdc)) || existsSync(defaultAdc));
  add("OpenAI runtime key", hasOpenAIKey, hasOpenAIKey ? "configured locally" : "OPENAI_API_KEY is empty; mock GPT is expected");
  add("xAI runtime key", hasXaiKey, hasXaiKey ? "configured locally" : "XAI_API_KEY is empty; mock X research is expected");
  add("YouTube runtime key", hasYouTubeKey, hasYouTubeKey ? "configured locally" : "YOUTUBE_API_KEY is empty; YouTube research is disabled");
  add(
    "image provider runtime key",
    hasPexelsKey || hasUnsplashKey,
    hasPexelsKey || hasUnsplashKey
      ? `configured locally (${[hasPexelsKey && "Pexels", hasUnsplashKey && "Unsplash"].filter(Boolean).join(" + ")})`
      : "both PEXELS_API_KEY and UNSPLASH_ACCESS_KEY are empty; uploads may still be used",
  );
  add(
    "GCS research memory",
    gcsEnabled && hasGcsBucket,
    gcsEnabled && hasGcsBucket
      ? "enabled with a bucket; Application Default Credentials still require an operator check"
      : "disabled or missing GCS_BUCKET; live X/YouTube/Hacker News research will not be reused",
  );
  add(
    "GCS local ADC hint",
    !gcsEnabled || hasLocalAdc,
    !gcsEnabled ? "not required while GCS memory is disabled" : hasLocalAdc
      ? "local Application Default Credentials file is present; bucket IAM is not tested"
      : "no local ADC file found; workload identity may still work in a hosted runtime",
  );
} else {
  add("OpenAI runtime key", false, "copy .env.example to .env before the live demo");
  add("xAI runtime key", false, "copy .env.example to .env before the live demo");
  add("YouTube runtime key", false, "copy .env.example to .env before the live demo");
  add("image provider runtime key", false, "configure Pexels or Unsplash, or rehearse with a local upload");
  add("GCS research memory", false, "copy .env.example to .env and configure GCS only if cache reuse is required");
  add("GCS local ADC hint", false, "no .env; ADC need depends on whether GCS memory will be enabled");
}

for (const check of checks) {
  console.log(`${check.ok ? "PASS" : "WARN"}  ${check.name} — ${check.detail}`);
}

const criticalFailures = checks.filter(
  (check) => !check.ok && !["OpenAI runtime key", "xAI runtime key", "YouTube runtime key", "image provider runtime key", "GCS research memory", "GCS local ADC hint", "Git repository", "commits after 2026-08-01 14:00 KST"].includes(check.name),
);
if (criticalFailures.length) process.exitCode = 1;

