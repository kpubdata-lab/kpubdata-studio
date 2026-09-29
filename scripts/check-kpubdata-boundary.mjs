#!/usr/bin/env node
/**
 * Fail when Studio's source names kpubdata implementation details (studio#511).
 *
 * The dependency direction is Studio → Builder → KPubData, and Studio consumes only
 * Builder's HTTP/OpenAPI contract. A comment that cites a kpubdata source path, a
 * Python module, a private constant or a test fixture as the reason for a Studio
 * value makes kpubdata's internals the contract owner: the value then silently goes
 * stale when kpubdata refactors, and nobody reading the contract can see why it holds.
 * `access` status values once cited kpubdata's `PROBE_STATUSES` this way.
 *
 * Citing kpubdata or kpubdata-builder *issues* (`kpubdata#504`) and public documents
 * is allowed; naming their code is not. Builder's OpenAPI contract file is the one
 * Builder path Studio may name, because it is the contract.
 *
 * Files come from `git ls-files src`, not a hand-written path list.
 *
 * Usage:
 *   node scripts/check-kpubdata-boundary.mjs
 */

import { execFileSync } from "node:child_process";
import { readFileSync, realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Overridable so the gate's own test can point it at a fixture repository.
const REPO = process.env.KPUBDATA_BOUNDARY_ROOT ?? join(dirname(fileURLToPath(import.meta.url)), "..");

/** Each rule names what it catches, so a failure says why. */
export const RULES = [
  {
    name: "kpubdata source path",
    pattern: /\bkpubdata(?:-builder)?\/(?:src|tests|scripts)\/|\bsrc\/kpubdata(?:_builder)?\b|\bkpubdata_builder\//,
  },
  {
    name: "Python module or file",
    pattern: /\bkpubdata(?:_builder)?\.[a-z_]+(?:\.[a-z_]+)*\b(?!-)|\b[\w/-]+\.py\b/,
  },
  {
    name: "private kpubdata constant",
    // A known private name, or an UPPER_SNAKE name attributed to kpubdata in the same phrase.
    pattern: /\bPROBE_STATUSES\b|kpubdata(?:'s|\s?의)\s+(?:[\w-]+\s+){0,3}\(?`?[A-Z][A-Z0-9]*_[A-Z0-9_]+/,
  },
  {
    name: "kpubdata test fixture",
    pattern: /\btests\/fixtures\b|\breplay fixture/i,
  },
];

/** Every `line: rule — text` in one file's content that crosses the boundary. */
export function violations(text) {
  const found = [];
  text.split("\n").forEach((line, index) => {
    for (const rule of RULES) {
      if (rule.pattern.test(line)) found.push({ line: index + 1, rule: rule.name, text: line.trim() });
    }
  });
  return found;
}

function main() {
  const files = execFileSync("git", ["ls-files", "src"], { cwd: REPO, encoding: "utf8" })
    .split("\n")
    .filter(Boolean);
  const failures = [];
  for (const file of files) {
    for (const v of violations(readFileSync(join(REPO, file), "utf8"))) {
      failures.push(`${file}:${v.line}: ${v.rule} — ${v.text}`);
    }
  }
  if (failures.length > 0) {
    console.error(`src/ names kpubdata implementation details in ${failures.length} place(s):`);
    for (const f of failures) console.error(`  ${f}`);
    console.error("Cite Builder's OpenAPI contract as the owner of the value instead (studio#511).");
    process.exit(1);
  }
  console.log(`kpubdata boundary OK: ${files.length} files under src/`);
}

// Run only as a script, so `violations` can be imported without scanning anything.
if (process.argv[1] && realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1])) main();
