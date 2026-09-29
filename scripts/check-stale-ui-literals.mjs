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

// Overridable so the gate's own test can point it at a fixture repository. Without
// that the test ran against this repository and asserted nothing — it passed for the
// wrong reason, which is the failure mode this whole script exists to prevent.
const REPO = process.env.STALE_UI_REPO_ROOT ?? join(dirname(fileURLToPath(import.meta.url)), "..");
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

function refExists(ref) {
  try {
    git(`rev-parse --verify --quiet ${ref}^{commit}`);
    return true;
  } catch {
    return false;
  }
}

// Checked up front rather than inferred from an empty result. localeValuesAt skips a
// file that did not exist at the ref, which is correct, but it made a missing ref look
// identical to "nothing was removed" — and the gate passed without comparing anything.
if (!refExists(base)) {
  console.log(`기준 ref ${base} 를 찾을 수 없어 건너뛴다`);
  process.exit(0);
}
const before = localeValuesAt(base);
const after = localeValuesAt(null);

const removed = [...before].filter((v) => !after.has(v) && v.length >= MIN_LENGTH);
if (removed.length === 0) {
  console.log(`UI 문자열이 제거되지 않았다 (기준 ${base})`);
  process.exit(0);
}

const testFiles = git("ls-files")
  .split("\n")
  .filter((f) => /\.(test|spec)\.tsx?$/.test(f));

// Two matches are not stale and used to fail the gate (studio#422):
//
// - Inside an identifier. Removing the UI word "Artifacts" matched the component
//   name `BuildArtifactsPage` in every test that imports it. A match whose edge is a
//   word character continuing past the removed value is part of a longer name.
// - Inside a current value. "데이터셋이 없습니다" was removed, and a test asserting the
//   new "조건에 맞는 소스 데이터셋이 없습니다" contains it. Current values are blanked
//   out first, so only text that no longer renders anywhere is left to match.
const current = [...after].filter((v) => v.length >= MIN_LENGTH).sort((a, b) => b.length - a.length);
const WORD = /[A-Za-z0-9_]/;

function withoutCurrentValues(source) {
  let out = source;
  for (const value of current) if (out.includes(value)) out = out.split(value).join("\u0000");
  return out;
}

function occursOutsideIdentifier(source, value) {
  const extendsLeft = WORD.test(value[0]);
  const extendsRight = WORD.test(value[value.length - 1]);
  for (let i = source.indexOf(value); i !== -1; i = source.indexOf(value, i + 1)) {
    const left = source[i - 1];
    const right = source[i + value.length];
    if (extendsLeft && left !== undefined && WORD.test(left)) continue;
    if (extendsRight && right !== undefined && WORD.test(right)) continue;
    return true;
  }
  return false;
}

const stale = new Map();
for (const file of testFiles) {
  const source = withoutCurrentValues(readFileSync(join(REPO, file), "utf8"));
  const hits = removed.filter((value) => occursOutsideIdentifier(source, value));
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
