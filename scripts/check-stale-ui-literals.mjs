#!/usr/bin/env node
/**
 * Fail when a change removes a UI string but leaves tests asserting on it (studio#429).
 *
 * Renaming the assistant changed 102 locale values. The first sweep covered `src/`
 * and `e2e/` and missed `__tests__/` at the repository root, so 43 test files kept
 * asserting on strings the product no longer shows. CI found it; nothing in the
 * repository did.
 *
 * The check compares this branch's locale files against the base branch and takes the
 * values that **disappeared**. A test that still contains one is asserting on text
 * nothing renders. That set is exact — no heuristic about which literals are labels,
 * and so no false positives to explain away.
 *
 * Two earlier designs failed and are recorded because the failures are the reason
 * this one looks like it does:
 *
 * 1. "Every Korean literal should exist in a locale value." Accepting a literal that
 *    *contains* a known value passed everything — a long stale sentence contains some
 *    short value almost always. Found by reverting one string and watching the gate
 *    stay green.
 * 2. "Only literals near a Testing Library query." Strings get hoisted into constants
 *    (`const HERO_HEADING = "…"`), so line proximity cannot see them.
 *
 * Usage:
 *   node scripts/check-stale-ui-literals.mjs             # against origin/main
 *   node scripts/check-stale-ui-literals.mjs --base HEAD~1
 */

import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");
const LOCALES = ["en", "ko"].map(
  (l) => `src/shared/i18n/locales/${l}.json`,
);

// Below this length a removed value is too generic to search for — "저장" appears in
// unrelated tests, and a false failure gets the check switched off.
const MIN_LENGTH = 8;

function git(args) {
  return execSync(`git ${args}`, { cwd: REPO, encoding: "utf8", maxBuffer: 64e6 });
}

/** Every string value in a locale document, flattened. */
function values(doc) {
  const out = new Set();
  const walk = (node) => {
    if (node && typeof node === "object") for (const v of Object.values(node)) walk(v);
    else if (typeof node === "string") out.add(node);
  };
  walk(doc);
  return out;
}

function localeValuesAt(ref) {
  const out = new Set();
  for (const path of LOCALES) {
    let text;
    try {
      text = ref === null ? readFileSync(join(REPO, path), "utf8") : git(`show ${ref}:${path}`);
    } catch {
      continue; // the file did not exist at that ref
    }
    for (const value of values(JSON.parse(text))) out.add(value);
  }
  return out;
}

const baseArg = process.argv.indexOf("--base");
const base = baseArg === -1 ? "origin/main" : process.argv[baseArg + 1];

let before;
try {
  before = localeValuesAt(base);
} catch {
  console.log(`기준 ref ${base} 를 찾을 수 없어 건너뛴다`);
  process.exit(0);
}
const after = localeValuesAt(null);

const removed = [...before].filter((v) => !after.has(v) && v.length >= MIN_LENGTH);
if (removed.length === 0) {
  console.log(`UI 문자열이 제거되지 않았다 (기준 ${base})`);
  process.exit(0);
}

const testFiles = git("ls-files")
  .split("\n")
  .filter((f) => /\.(test|spec)\.tsx?$/.test(f));

const stale = new Map();
for (const file of testFiles) {
  const source = readFileSync(join(REPO, file), "utf8");
  const hits = removed.filter((value) => source.includes(value));
  if (hits.length) stale.set(file, hits);
}

console.log(`제거된 UI 문자열 ${removed.length}건 (기준 ${base})`);

if (stale.size === 0) {
  console.log("그 문자열을 단정하는 테스트 없음");
  process.exit(0);
}

console.error(
  "\n제거된 UI 문자열을 아직 단정하는 테스트가 있다. 문구를 바꿨으면 테스트도 같이 바꾼다.\n",
);
for (const [file, hits] of stale) {
  console.error(`  ${file}`);
  for (const hit of hits.slice(0, 3)) console.error(`      ${JSON.stringify(hit)}`);
  if (hits.length > 3) console.error(`      … ${hits.length - 3}건 더`);
}
console.error(
  "\nlocale 의 git diff 에서 old→new 매핑을 뽑아 긴 것부터 치환하는 것이" +
    "\n손으로 목록을 쓰는 것보다 정확하다.",
);
process.exit(1);
