import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const cutoff = Date.parse("2026-08-01T14:00:00+09:00");
const requiredFiles = [
  "README.md",
  ".env.example",
  "src/agent/runner.ts",
  "src/agent/prompt.ts",
  "src/providers/xai.ts",
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
  add("OpenAI runtime key", hasOpenAIKey, hasOpenAIKey ? "configured locally" : "OPENAI_API_KEY is empty; mock GPT is expected");
  add("xAI runtime key", hasXaiKey, hasXaiKey ? "configured locally" : "XAI_API_KEY is empty; mock X research is expected");
} else {
  add("OpenAI runtime key", false, "copy .env.example to .env before the live demo");
  add("xAI runtime key", false, "copy .env.example to .env before the live demo");
}

for (const check of checks) {
  console.log(`${check.ok ? "PASS" : "WARN"}  ${check.name} — ${check.detail}`);
}

const criticalFailures = checks.filter(
  (check) => !check.ok && !["OpenAI runtime key", "xAI runtime key", "Git repository", "commits after 2026-08-01 14:00 KST"].includes(check.name),
);
if (criticalFailures.length) process.exitCode = 1;

