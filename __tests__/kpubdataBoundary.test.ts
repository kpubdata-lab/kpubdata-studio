/**
 * Studio's backend contract is Builder's HTTP/OpenAPI, and nothing else (#511).
 *
 * The owner's 2026-09-30 decision (Independence Rules 8 and 9): Studio may link to
 * kpubdata's governance and brand documents, but it must not reach into kpubdata's
 * repository layout, fixtures, catalogue files or Python modules. The real-E2E runner
 * used to read `../kpubdata/tests/fixtures`, so Studio silently depended on a sibling
 * checkout's internal directory. This fails on any such reference in a tracked file.
 *
 * Exempt: `.github/` (shared CI actions are governance tooling, #631), CHANGELOG
 * history, and this file.
 */

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/** kpubdata implementation details: its checkout, its internal paths, its Python modules. */
const FORBIDDEN: Array<[string, RegExp]> = [
  ["sibling kpubdata checkout", /\.\.\/kpubdata(?![-\w])|["']\.\.["']\s*,\s*["']kpubdata["']/],
  ["kpubdata repository path", /\bkpubdata\/(src|tests|specs|scripts)\/|\bsrc\/kpubdata\//],
  ["kpubdata Python module", /\b(from|import)\s+kpubdata\b(?!_builder)|\bkpubdata\.(core|providers|config|transport|specs)\b/],
  ["kpubdata catalogue or support table", /\bcatalogue\.json\b|\bSUPPORTED_DATA\b|specs\/schema\.json/],
  ["kpubdata root option", /--kpubdata-root/],
  // kpubdata's own settings (#541). Builder's are KPUBDATA_BUILDER_*, Studio's KPUBDATA_STUDIO_*
  // and KPUBDATA_CONFIG_OUT; replay and provider keys are Builder's to set now.
  ["kpubdata setting", /\bKPUBDATA_(?:MODE|REPLAY_DIR|CACHE_[A-Z_]+|(?!BUILDER_|STUDIO_)[A-Z0-9]+_API_KEY)\b/],
];

export function boundaryViolations(file: string, source: string): string[] {
  return source.split("\n").flatMap((line, index) =>
    FORBIDDEN.filter(([, pattern]) => pattern.test(line)).map(([what]) => `${file}:${index + 1}: ${what}`),
  );
}

describe("kpubdata boundary gate (#511)", () => {
  it("no tracked file depends on kpubdata's implementation", () => {
    const files = execFileSync("git", ["ls-files"], { cwd: ROOT, encoding: "utf8" })
      .split("\n")
      .filter(
        (file) =>
          /\.(ts|tsx|mjs|js|sh|md|json|ya?ml)$/.test(file) &&
          !file.startsWith(".github/") &&
          !file.endsWith("CHANGELOG.md") &&
          !file.endsWith("package-lock.json") &&
          file !== "__tests__/kpubdataBoundary.test.ts",
      );
    const hits = files.flatMap((file) => {
      try {
        return boundaryViolations(file, readFileSync(join(ROOT, file), "utf8"));
      } catch {
        return []; // a symlink to a directory, or a deleted file still in the index
      }
    });
    expect(hits).toEqual([]);
  });

  describe("the check fails when it should", () => {
    it.each([
      ['join(process.cwd(), "..", "kpubdata")', "sibling kpubdata checkout"],
      ["see ../kpubdata/tests/fixtures", "sibling kpubdata checkout"],
      ["kpubdata/tests/fixtures/datago", "kpubdata repository path"],
      ["from kpubdata.core.spec import x", "kpubdata Python module"],
      ["read providers/datago/catalogue.json", "kpubdata catalogue or support table"],
      ["node run.mjs --kpubdata-root x", "kpubdata root option"],
      ['KPUBDATA_MODE: "replay"', "kpubdata setting"],
      ["KPUBDATA_DATAGO_API_KEY=x", "kpubdata setting"],
    ])("flags %s", (line, what) => {
      expect(boundaryViolations("f", line)).toContain(`f:1: ${what}`);
    });

    it.each([
      "https://github.com/kpubdata-lab/kpubdata/blob/main/docs/governance/POLICY.md",
      "../kpubdata-builder",
      "import kpubdata_builder",
      "kpubdata-brand-assets/svg/favicon.svg",
      "kpubdata#282",
      "KPUBDATA_BUILDER_DEV_MODE=true",
      "KPUBDATA_STUDIO_VERSION=0.3.0",
      "KPUBDATA_CONFIG_OUT=/tmp/x",
    ])("allows %s", (line) => {
      expect(boundaryViolations("f", line)).toEqual([]);
    });
  });
});
