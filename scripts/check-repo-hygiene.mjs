// Guard for a public repo: refuse to publish secrets, personal data, or files
// that belong on the machine rather than on GitHub.
//
//   node scripts/check-repo-hygiene.mjs
//
// Runs in two places: the pre-push hook (.githooks/pre-push) blocks it before
// it ever leaves the machine, and CI (.github/workflows/guard.yml) re-checks
// every push, since hooks can be bypassed with --no-verify.
//
// It scans the tracked tree, not the diff — a file that slipped in three
// commits ago is just as public as one added now.

import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";

const MAX_BYTES = 1_500_000; // largest legitimate asset is the 962 KB .icns

/** Files that must never be tracked, whatever their content. */
const FORBIDDEN_PATHS = [
  [/(^|\/)perf\.jsonl(\.\d+)?$/, "Parker's performance log (contains process data)"],
  [/(^|\/)session\.json$/, "Parker's saved session (lists your note names)"],
  [/(^|\/)settings\.json$/, "Parker's settings (contains your notes folder path)"],
  [/(^|\/)Untitled-\d+\.(md|txt)$/, "a scratch note"],
  [/\.parker-tmp$/, "an autosave temp file"],
  [/\.(dmg|app|zip)$/, "a build artifact (ship it on a Release, not in git)"],
  [/(^|\/)\.env/, "an environment file"],
  [/(^|\/)\.vercel\//, "Vercel project ids"],
  [/(^|\/)\.claude\//, "local agent tooling/config"],
  [/(^|\/)\.DS_Store$/, "macOS folder metadata"],
];

/** Content patterns. Each: [regex, what it is]. */
const SECRETS = [
  [/\bsk-[A-Za-z0-9]{16,}\b/, "an API key (sk-…)"],
  [/\bghp_[A-Za-z0-9]{20,}\b/, "a GitHub token (ghp_…)"],
  [/\bgithub_pat_[A-Za-z0-9_]{20,}\b/, "a GitHub fine-grained token"],
  [/\bAKIA[0-9A-Z]{16}\b/, "an AWS access key id"],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, "a private key"],
  [/\bxox[baprs]-[A-Za-z0-9-]{10,}\b/, "a Slack token"],
  [/\bBearer\s+[A-Za-z0-9._-]{24,}\b/, "a bearer token"],
  [/(password|passwd|secret|api[_-]?key|access[_-]?token)\s*[:=]\s*["'][^"'\s]{10,}["']/i,
   "a hardcoded credential"],
];

const PERSONAL = [
  [/\/Users\/[A-Za-z0-9._-]+\//, "an absolute path from someone's home folder"],
  [
    /(?<![\w.@+-])[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+\.[A-Za-z]{2,}(?![\w-])/,
    "an email address",
  ],
];

/** Substrings that make an email/path match a known false positive. */
const ALLOW = [
  "noreply@", "example.com", "@2x", "@3x", "schema.", "w3.org", "purl.org",
  "fonts.googleapis.com", "fonts.gstatic.com", "@types/", "@tauri-apps/",
  "git@github.com:owner/repo", "user@host",
];

/** Files whose content we don't scan (generated, binary, or noisy). */
const SKIP_CONTENT = /(^|\/)(pnpm-lock\.yaml|Cargo\.lock)$|\.(png|jpg|jpeg|webp|gif|icns|ico|svg|woff2?|pdf)$/;

const files = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" })
  .split("\0")
  .filter(Boolean);

const problems = [];

for (const file of files) {
  for (const [re, what] of FORBIDDEN_PATHS)
    if (re.test(file)) problems.push({ file, line: 0, what: `${what} — this file shouldn't be tracked` });

  let size = 0;
  try {
    size = statSync(file).size;
  } catch {
    continue; // deleted but still indexed
  }
  if (size > MAX_BYTES)
    problems.push({
      file,
      line: 0,
      what: `${Math.round(size / 1024)} KB — over the ${Math.round(MAX_BYTES / 1024)} KB limit; is this a build artifact?`,
    });

  if (SKIP_CONTENT.test(file) || size > MAX_BYTES) continue;

  let text;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    continue;
  }
  if (text.includes("\0")) continue; // binary

  text.split("\n").forEach((line, i) => {
    if (ALLOW.some((a) => line.includes(a))) return;
    for (const [re, what] of [...SECRETS, ...PERSONAL]) {
      const m = re.exec(line);
      if (m) problems.push({ file, line: i + 1, what, hit: m[0].slice(0, 60) });
    }
  });
}

if (problems.length) {
  console.error("\nRepo hygiene: this must not go public\n");
  for (const p of problems)
    console.error(
      `  ${p.file}${p.line ? ":" + p.line : ""}\n    ${p.what}${p.hit ? `\n    → ${p.hit}` : ""}`
    );
  console.error(
    `\n${problems.length} problem(s). Fix them, or if it's a false positive add the` +
      ` snippet to ALLOW in scripts/check-repo-hygiene.mjs.\n`
  );
  process.exit(1);
}

console.log(`Repo hygiene OK — ${files.length} tracked files scanned.`);
