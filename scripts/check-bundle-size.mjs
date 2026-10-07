#!/usr/bin/env node
/**
 * JavaScript bundle size budget (studio#665).
 *
 * Route-level code splitting (#378) took the app off a single 1.14 MB chunk (gzip
 * 335 KB), but nothing measured the chunks afterwards: a dependency or a static import
 * that pulls a route back into the entry chunk would go unnoticed. This reads the
 * `vite build` output (`dist/assets/*.js`) and fails when it is over budget.
 *
 * It runs as npm's `postbuild`, so `npm run build` — the command CI's build job, the
 * Pages deploy and the release job already run — checks it with no workflow change.
 * `npm run size:check` runs it alone against an existing `dist/`.
 *
 * Sizes are gzip (level 9, what a browser downloads from a gzip-serving host) as well
 * as raw bytes, in KiB (1024 bytes), measured by this script. The budgets were set from
 * `vite build` on 2026-10-01 (origin/main 6502909, 58 chunks) with roughly 10–15% headroom:
 *
 *   | measured on 2026-10-01                 | value          | budget   |
 *   |----------------------------------------|----------------|----------|
 *   | entry chunk (index-*.js), gzip          | 137.5 KiB      | 160 KiB  |
 *   | largest chunk of any kind, gzip         | 137.5 KiB      | 160 KiB  |
 *   | largest chunk of any kind, raw          | 453.7 KiB      | 520 KiB  |
 *   | all JavaScript together, gzip           | 452.2 KiB      | 500 KiB  |
 *
 * The **initial load** is what a visitor downloads before the first screen: the entry
 * chunk and every chunk it imports statically, followed through their own static imports
 * (a dynamic `import()` — a route, a locale — is not followed). Before #796 both locale
 * files sat in it; measured on 2026-10-07 (origin/main 0ad15c3) it went from 326.4 KiB to
 * 237.3 KiB gzip when they moved to their own chunks, with one locale (43–48 KiB) fetched
 * after it. The budget is 270 KiB, so a static import that pulls a locale (or a route) back
 * in fails:
 *
 *   | initial load (entry + static imports), gzip | 237.3 KiB  | 270 KiB  |
 *
 * A budget raised to let a change through says so in its pull request, with the build
 * output that shows why. The #378 regression (one 335 KB gzip chunk) fails the first
 * three lines by a wide margin.
 *
 * Usage:
 *   node scripts/check-bundle-size.mjs              # reads ./dist
 *   node scripts/check-bundle-size.mjs --dir out    # another build directory
 */

import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

const KIB = 1024;

/** Budgets in bytes. See the table above for where each number came from. */
export const BUDGET = Object.freeze({
  entryGzip: 160 * KIB,
  chunkGzip: 160 * KIB,
  chunkRaw: 520 * KIB,
  totalGzip: 500 * KIB,
  initialGzip: 270 * KIB,
});

/** Vite names the entry chunk `index-<hash>.js`. */
export const ENTRY_PATTERN = /^index-[\w-]+\.js$/;

/** Every `*.js` file in `<dir>/assets` with its raw and gzip size. */
export function measure(dir) {
  const assets = join(dir, "assets");
  let names;
  try {
    names = readdirSync(assets);
  } catch {
    return [];
  }
  return names
    .filter((name) => name.endsWith(".js"))
    .map((name) => {
      const bytes = readFileSync(join(assets, name));
      return { name, raw: bytes.length, gzip: gzipSync(bytes, { level: 9 }).length };
    })
    .sort((a, b) => b.gzip - a.gzip);
}

export function kib(bytes) {
  return `${(bytes / KIB).toFixed(1)} KiB`;
}

/** `import … from "./x.js"`, `import "./x.js"` and `export … from "./x.js"`, not `import("./x.js")`. */
const STATIC_IMPORT = /\b(?:import|export)\s*(?:[^"'();]*?\bfrom\s*)?["']\.\/([\w.-]+\.js)["']/g;

/**
 * The chunks a visitor downloads before the first screen: the entry chunk and, followed
 * transitively, every chunk imported statically. Names only; sizes come from `measure`.
 */
export function initialChunks(dir, chunks) {
  const assets = join(dir, "assets");
  const known = new Set(chunks.map((chunk) => chunk.name));
  const seen = new Set();
  const pending = chunks.filter((chunk) => ENTRY_PATTERN.test(chunk.name)).map((chunk) => chunk.name);
  while (pending.length > 0) {
    const name = pending.pop();
    if (seen.has(name) || !known.has(name)) continue;
    seen.add(name);
    for (const match of readFileSync(join(assets, name), "utf8").matchAll(STATIC_IMPORT)) pending.push(match[1]);
  }
  return [...seen].sort();
}

/**
 * Compare measured chunks with a budget. Returns the failures as sentences; an empty
 * list passes. No chunks at all, or no entry chunk, is a failure: a gate that finds
 * nothing to measure must not pass.
 */
export function checkBudget(chunks, budget = BUDGET, initial = null) {
  const failures = [];
  if (chunks.length === 0) {
    return ["no JavaScript found under assets/ — run `vite build` first, or pass --dir"];
  }
  const entry = chunks.filter((chunk) => ENTRY_PATTERN.test(chunk.name));
  if (entry.length === 0) failures.push("no entry chunk (index-*.js) found under assets/");
  for (const chunk of entry) {
    if (chunk.gzip > budget.entryGzip) {
      failures.push(`entry chunk ${chunk.name} is ${kib(chunk.gzip)} gzip, over the ${kib(budget.entryGzip)} budget`);
    }
  }
  for (const chunk of chunks) {
    if (chunk.gzip > budget.chunkGzip) {
      failures.push(`chunk ${chunk.name} is ${kib(chunk.gzip)} gzip, over the ${kib(budget.chunkGzip)} per-chunk budget`);
    }
    if (chunk.raw > budget.chunkRaw) {
      failures.push(`chunk ${chunk.name} is ${kib(chunk.raw)} raw, over the ${kib(budget.chunkRaw)} per-chunk budget`);
    }
  }
  const totalGzip = chunks.reduce((sum, chunk) => sum + chunk.gzip, 0);
  if (totalGzip > budget.totalGzip) {
    failures.push(`all JavaScript is ${kib(totalGzip)} gzip, over the ${kib(budget.totalGzip)} budget`);
  }
  if (initial !== null) {
    const names = new Set(initial);
    const initialGzip = chunks.filter((chunk) => names.has(chunk.name)).reduce((sum, chunk) => sum + chunk.gzip, 0);
    if (initialGzip > budget.initialGzip) {
      failures.push(
        `the initial load (${initial.length} chunks: the entry and its static imports) is ${kib(initialGzip)} gzip, over the ${kib(budget.initialGzip)} budget`,
      );
    }
  }
  return failures;
}

function main(argv) {
  const at = argv.indexOf("--dir");
  const dir = resolve(at >= 0 && argv[at + 1] ? argv[at + 1] : "dist");
  const chunks = measure(dir);
  const initial = initialChunks(dir, chunks);
  const failures = checkBudget(chunks, BUDGET, initial);
  const initialGzip = chunks.filter((chunk) => initial.includes(chunk.name)).reduce((sum, chunk) => sum + chunk.gzip, 0);

  const totalRaw = chunks.reduce((sum, chunk) => sum + chunk.raw, 0);
  const totalGzip = chunks.reduce((sum, chunk) => sum + chunk.gzip, 0);
  console.log(`bundle size: ${chunks.length} JavaScript chunks in ${join(dir, "assets")}`);
  for (const chunk of chunks.slice(0, 5)) {
    console.log(`  ${chunk.name.padEnd(40)} ${kib(chunk.raw).padStart(12)} raw ${kib(chunk.gzip).padStart(12)} gzip`);
  }
  console.log(`  ${"total".padEnd(40)} ${kib(totalRaw).padStart(12)} raw ${kib(totalGzip).padStart(12)} gzip`);
  console.log(`  ${`initial load (${initial.length} chunks)`.padEnd(40)} ${"".padStart(16)} ${kib(initialGzip).padStart(12)} gzip`);
  console.log(
    `  budget: entry ${kib(BUDGET.entryGzip)} gzip, any chunk ${kib(BUDGET.chunkGzip)} gzip / ${kib(BUDGET.chunkRaw)} raw, total ${kib(BUDGET.totalGzip)} gzip, initial load ${kib(BUDGET.initialGzip)} gzip`,
  );

  if (failures.length > 0) {
    console.error("\nbundle size budget exceeded:");
    for (const failure of failures) console.error(`  - ${failure}`);
    console.error("\nSplit the chunk (route-level lazy import, #378) or, if the growth is intended, raise the budget in scripts/check-bundle-size.mjs and say why in the pull request.");
    return 1;
  }
  console.log("bundle size: within budget");
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
