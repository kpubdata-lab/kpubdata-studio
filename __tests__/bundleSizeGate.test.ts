/**
 * The bundle size budget has to actually fail (#665).
 *
 * `checkBudget` is checked against synthetic chunk lists, and the script itself is run
 * against fixture build directories: one inside the budget exits 0, one with an entry
 * chunk the size of the pre-#378 single chunk exits non-zero, and an empty one — no
 * build to measure — exits non-zero instead of passing.
 */
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { BUDGET, checkBudget, initialChunks, measure, type Chunk } from "../scripts/check-bundle-size.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPT = join(ROOT, "scripts", "check-bundle-size.mjs");
const KIB = 1024;

const chunk = (name: string, rawKib: number, gzipKib: number): Chunk => ({ name, raw: rawKib * KIB, gzip: gzipKib * KIB });

describe("checkBudget", () => {
  const healthy = [chunk("index-abc.js", 450, 137), chunk("i18n-def.js", 300, 93), chunk("Page-ghi.js", 50, 17)];

  it("passes a build inside every budget", () => {
    expect(checkBudget(healthy)).toEqual([]);
  });

  it("fails an entry chunk over its gzip budget", () => {
    const failures = checkBudget([chunk("index-abc.js", 500, BUDGET.entryGzip / KIB + 1)]);
    expect(failures.some((f) => f.startsWith("entry chunk index-abc.js"))).toBe(true);
  });

  it("fails any chunk over the per-chunk gzip or raw budget", () => {
    expect(checkBudget([...healthy, chunk("Big-xyz.js", 100, BUDGET.chunkGzip / KIB + 1)])).toEqual([
      expect.stringMatching(/^chunk Big-xyz\.js is .* gzip, over/),
    ]);
    expect(checkBudget([...healthy, chunk("Wide-xyz.js", BUDGET.chunkRaw / KIB + 1, 10)])).toEqual([
      expect.stringMatching(/^chunk Wide-xyz\.js is .* raw, over/),
    ]);
  });

  it("fails when the chunks together are over the total budget, though each is small", () => {
    const many = Array.from({ length: 10 }, (_, i) => chunk(`Part${i}-x.js`, 100, BUDGET.totalGzip / KIB / 10 + 1));
    const failures = checkBudget([chunk("index-abc.js", 10, 5), ...many]);
    expect(failures).toEqual([expect.stringMatching(/^all JavaScript is .* over/)]);
  });

  it("fails the single 1.14 MB chunk #378 removed", () => {
    expect(checkBudget([chunk("index-abc.js", 1140, 335)]).length).toBeGreaterThanOrEqual(3);
  });

  it("fails an initial load over its budget, though every chunk is small (#796)", () => {
    const parts = Array.from({ length: 4 }, (_, i) => chunk(`Part${i}-x.js`, 100, BUDGET.initialGzip / KIB / 4));
    const all = [chunk("index-abc.js", 10, 5), ...parts];
    const failures = checkBudget(all, BUDGET, all.map((c) => c.name));
    expect(failures).toEqual([expect.stringMatching(/^the initial load \(5 chunks.* over the 270\.0 KiB budget$/)]);
    // The same chunks loaded later (not in the initial list) are within budget.
    expect(checkBudget(all, BUDGET, ["index-abc.js"])).toEqual([]);
  });

  it("does not pass when there is nothing to measure, or no entry chunk", () => {
    expect(checkBudget([])).toHaveLength(1);
    expect(checkBudget([chunk("Page-ghi.js", 50, 17)])).toEqual([expect.stringMatching(/no entry chunk/)]);
  });
});

describe("check-bundle-size.mjs", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "bundle-size-"));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  function writeChunk(name: string, bytes: Buffer) {
    mkdirSync(join(dir, "assets"), { recursive: true });
    writeFileSync(join(dir, "assets", name), bytes);
  }

  function run(): { code: number; out: string } {
    try {
      const out = execFileSync("node", [SCRIPT, "--dir", dir], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
      return { code: 0, out };
    } catch (error) {
      const e = error as { status?: number; stdout?: string; stderr?: string };
      return { code: e.status ?? 1, out: `${e.stdout ?? ""}${e.stderr ?? ""}` };
    }
  }

  it("exits 0 for a build inside the budget", () => {
    writeChunk("index-abc.js", Buffer.from("console.log('small');".repeat(100)));
    writeChunk("Page-def.js", Buffer.from("export const x = 1;"));
    writeChunk("index-abc.css", randomBytes(400 * KIB)); // not JavaScript: not counted
    const { code, out } = run();
    expect(out).toContain("within budget");
    expect(code).toBe(0);
    expect(measure(dir).map((c) => c.name).sort()).toEqual(["Page-def.js", "index-abc.js"]);
  });

  it("exits non-zero for an entry chunk over budget", () => {
    // Random bytes do not compress, so gzip stays above the budget.
    writeChunk("index-abc.js", randomBytes(BUDGET.entryGzip + 10 * KIB));
    const { code, out } = run();
    expect(code).not.toBe(0);
    expect(out).toContain("bundle size budget exceeded");
    expect(out).toContain("entry chunk index-abc.js");
  });

  it("follows static imports from the entry chunk, not dynamic ones (#796)", () => {
    writeChunk("index-abc.js", Buffer.from('import{a as b}from"./ui-def.js";import"./side-ghi.js";const l=()=>import("./ko-jkl.js");'));
    writeChunk("ui-def.js", Buffer.from('export*from"./dep-mno.js";export const a=1;'));
    writeChunk("side-ghi.js", Buffer.from("console.log(1);"));
    writeChunk("dep-mno.js", Buffer.from("export const d=1;"));
    writeChunk("ko-jkl.js", Buffer.from("export default {};"));
    writeChunk("Page-pqr.js", Buffer.from('import{a}from"./ui-def.js";'));
    expect(initialChunks(dir, measure(dir))).toEqual(["dep-mno.js", "index-abc.js", "side-ghi.js", "ui-def.js"]);
  });

  it("exits non-zero when the entry statically imports more than the initial budget", () => {
    // A locale imported statically again — what #796 moved out. Random bytes do not compress.
    writeChunk("index-abc.js", Buffer.from('import l from"./ko-abc.js";console.log(l);'));
    for (const part of ["ko-abc.js", "en-abc.js"]) writeChunk(part, randomBytes(140 * KIB));
    expect(run().code).toBe(0); // en-abc.js alone is not part of the initial load
    writeChunk("index-abc.js", Buffer.from('import l from"./ko-abc.js";import m from"./en-abc.js";console.log(l,m);'));
    const { code, out } = run();
    expect(code).not.toBe(0);
    expect(out).toContain("the initial load (3 chunks");
  });

  it("exits non-zero when there is no build to measure", () => {
    const { code, out } = run();
    expect(code).not.toBe(0);
    expect(out).toContain("no JavaScript found");
  });
});

describe("wiring", () => {
  it("runs after every `npm run build`, which CI's build job runs", () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as { scripts: Record<string, string> };
    expect(pkg.scripts.postbuild).toBe("node scripts/check-bundle-size.mjs");
    expect(pkg.scripts["size:check"]).toBe("node scripts/check-bundle-size.mjs");
    const ci = readFileSync(join(ROOT, ".github/workflows/ci.yml"), "utf8");
    expect(ci).toMatch(/run: npm run build\b/);
  });
});
