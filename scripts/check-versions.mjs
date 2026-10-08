// Parker states its version in many places — the Mac app, the site's download
// links, and the iPhone app (same series, its own patch) — and a release is
// only coherent if they agree. They drift silently: nothing breaks at build time when the DMG
// filename says one thing and the site's download link says another — you find
// out when someone clicks it.
//
//   node scripts/check-versions.mjs
//
// package.json is the source of truth; everything else has to match it.

import { readFileSync } from "node:fs";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const SEMVER = String.raw`\d+\.\d+\.\d+`;

const want = JSON.parse(read("package.json")).version;
const problems = [];

/** One value that must equal `want`, pulled out by a regex. */
function check(file, label, source, re) {
  const m = source.match(re);
  if (!m) {
    // A guard that quietly finds nothing is worse than no guard: it reads as
    // a pass. If the shape changed, that is itself the thing to report.
    problems.push(`${file}: could not find ${label} — has the file changed shape?`);
    return;
  }
  if (m[1] !== want) problems.push(`${file}: ${label} is ${m[1]}, expected ${want}`);
}

/** Every occurrence of a pattern must equal `want`, and there must be some. */
function checkAll(file, label, source, re) {
  const found = [...source.matchAll(re)].map((m) => m[1]);
  if (found.length === 0) {
    problems.push(`${file}: could not find ${label} — has the file changed shape?`);
    return;
  }
  for (const got of found)
    if (got !== want) problems.push(`${file}: ${label} is ${got}, expected ${want}`);
}

check("src-tauri/tauri.conf.json", "version", read("src-tauri/tauri.conf.json"),
  new RegExp(String.raw`"version"\s*:\s*"(${SEMVER})"`));

check("src-tauri/Cargo.toml", "package version", read("src-tauri/Cargo.toml"),
  new RegExp(String.raw`^version\s*=\s*"(${SEMVER})"`, "m"));

// The lockfile carries the crate's own version too, and `cargo check` is what
// refreshes it — easy to forget after bumping Cargo.toml by hand.
check("src-tauri/Cargo.lock", "the parker entry", read("src-tauri/Cargo.lock"),
  new RegExp(String.raw`name = "parker"\nversion = "(${SEMVER})"`));

// The landing page: the release tag, the DMG filename, and the line under the
// download button. All three are what a visitor actually gets.
const site = read("site/index.html");
checkAll("site/index.html", "the release tag in the download link", site,
  new RegExp(String.raw`/releases/download/v(${SEMVER})/`, "g"));
checkAll("site/index.html", "the DMG filename", site,
  new RegExp(String.raw`Parker_(${SEMVER})_`, "g"));
checkAll("site/index.html", "the version under the download button", site,
  new RegExp(String.raw`v(${SEMVER})\s*·`, "g"));

// The features page carries its own download CTA — added after this guard was
// written, which is exactly how a check goes stale: the page it does not know
// about is the one that ships a dead link.
const features = read("site/features/index.html");
checkAll("site/features/index.html", "the release tag in the download link", features,
  new RegExp(String.raw`/releases/download/v(${SEMVER})/`, "g"));
checkAll("site/features/index.html", "the DMG filename", features,
  new RegExp(String.raw`Parker_(${SEMVER})_`, "g"));
checkAll("site/features/index.html", "the version under the download button", features,
  new RegExp(String.raw`v(${SEMVER})\s*·`, "g"));

// The /agents page has a download CTA too (27/09: it shipped with 1.4.0 links
// the guard didn't look at — the same story as features, above).
const agents = read("site/agents/index.html");
checkAll("site/agents/index.html", "the release tag in the download link", agents,
  new RegExp(String.raw`/releases/download/v(${SEMVER})/`, "g"));
checkAll("site/agents/index.html", "the DMG filename", agents,
  new RegExp(String.raw`Parker_(${SEMVER})_`, "g"));
checkAll("site/agents/index.html", "the version under the download button", agents,
  new RegExp(String.raw`v(${SEMVER})\s*·`, "g"));

// The iPhone app is in the same series as the Mac — the same major.minor
// (1.5.x on both) — and moves its patch only when it changes (decided 08/10,
// at Mac 1.5.2: a new number on an unchanged app says nothing). Its build
// number is separate (the date).
{
  const file = "ios/Parker/project.yml";
  const m = read(file).match(new RegExp(String.raw`MARKETING_VERSION:\s*"(${SEMVER})"`));
  const series = (v) => v.split(".").slice(0, 2).join(".");
  if (!m) problems.push(`${file}: could not find the iPhone's MARKETING_VERSION — has the file changed shape?`);
  else if (series(m[1]) !== series(want))
    problems.push(`${file}: the iPhone's MARKETING_VERSION is ${m[1]}, expected ${series(want)}.x`);
  else if (m[1].localeCompare(want, undefined, { numeric: true }) > 0)
    problems.push(`${file}: the iPhone's MARKETING_VERSION ${m[1]} is ahead of the Mac's ${want}`);
}

// …and the app must read it: an Info.plist with a literal version ships that
// literal (every iPhone build until 1.5.0 went out as 1.0, found 28/09).
const plist = read("ios/Parker/Sources/Info.plist");
if (!/<key>CFBundleShortVersionString<\/key>\s*<string>\$\(MARKETING_VERSION\)<\/string>/.test(plist))
  problems.push("ios/Parker/Sources/Info.plist: CFBundleShortVersionString must be $(MARKETING_VERSION)");
if (!/<key>CFBundleVersion<\/key>\s*<string>\$\(CURRENT_PROJECT_VERSION\)<\/string>/.test(plist))
  problems.push("ios/Parker/Sources/Info.plist: CFBundleVersion must be $(CURRENT_PROJECT_VERSION)");

if (problems.length) {
  console.error(`Version mismatch — package.json says ${want}:\n`);
  for (const p of problems) console.error(`  ✗ ${p}`);
  console.error(
    "\nBump every one of them together. See the release ritual in the backlog."
  );
  process.exit(1);
}

console.log(`Versions agree — the Mac and the site say ${want}; the iPhone is in the same ${want.split(".").slice(0, 2).join(".")}.x series.`);
