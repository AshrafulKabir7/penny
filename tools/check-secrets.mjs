// Fails if anything that is about to be committed or pushed looks like a credential.
//   node tools/check-secrets.mjs          scans every file git tracks or would add
//   node tools/check-secrets.mjs --history  also scans every commit ever made

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const PATTERNS = [
  ["Anthropic API key", /sk-ant-[A-Za-z0-9_-]{20,}/],
  ["OpenAI API key", /sk-(?:proj-)?[A-Za-z0-9_-]{32,}/],
  ["GitHub token", /(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,}/],
  ["Google API key", /AIza[0-9A-Za-z_-]{35}/],
  ["AWS access key", /AKIA[0-9A-Z]{16}/],
  ["Slack token", /xox[abpors]-[A-Za-z0-9-]{10,}/],
  ["private key", /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ["bearer token", /Bearer\s+[A-Za-z0-9._~+/-]{30,}/],
  ["password or key value", /(?:password|passwd|secret|api[_-]?key|access[_-]?token)["']?\s*[:=]\s*["'][^"'\s]{12,}["']/i],
];

const git = (...args) => execFileSync("git", args, { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
const findings = [];

function scan(label, text) {
  text.split(/\r?\n/).forEach((line, i) => {
    for (const [kind, re] of PATTERNS) if (re.test(line)) findings.push(`${label}:${i + 1}  ${kind}`);
  });
}

for (const file of git("ls-files", "-co", "--exclude-standard").split(/\r?\n/).filter(Boolean)) {
  if (file === "tools/check-secrets.mjs") continue; // the patterns themselves
  try {
    scan(file, readFileSync(file, "utf8"));
  } catch {}
}
if (process.argv.includes("--history")) scan("history", git("log", "--all", "-p", "--", ".", ":!tools/check-secrets.mjs"));

if (findings.length) {
  console.error(`Possible credentials found; nothing should be pushed until they are removed:\n${findings.join("\n")}`);
  process.exit(1);
}
console.log("No credentials found.");
