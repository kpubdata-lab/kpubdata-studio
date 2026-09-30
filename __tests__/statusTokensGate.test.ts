/**
 * Status colours come from the status tokens, not from raw palette classes (#425).
 *
 * VISUAL_IDENTITY §3.2: success, warning, failure and unknown are tokens with light and
 * dark values of their own, distinct from the brand colour. Screens used to write
 * `text-amber-700 dark:text-amber-300` and friends directly — 41 files — so a status's
 * colour could drift per screen and nothing tied it to the palette. This fails when a raw
 * status hue comes back.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const RAW = /(?<![\w-])(?:[a-z-]+:)*(?:bg|text|border|ring|fill|stroke|divide|outline|decoration|placeholder|accent)-(?:amber|yellow|orange|emerald|green|lime|red|rose)-\d{2,3}(?![\w-])/g;

export function rawStatusClasses(file: string, source: string): string[] {
  return [...source.matchAll(RAW)].map((match) => `${file}: ${match[0]}`);
}

describe("status tokens gate (#425)", () => {
  it("no screen paints a status with a raw palette class", () => {
    const files = execFileSync("git", ["ls-files", "src"], { cwd: ROOT, encoding: "utf8" })
      .split("\n")
      .filter((file) => /\.(ts|tsx)$/.test(file) && !file.includes(".test."));
    expect(files.flatMap((file) => rawStatusClasses(file, readFileSync(join(ROOT, file), "utf8")))).toEqual([]);
  });

  it("flags raw hues, including dark and hover variants", () => {
    expect(rawStatusClasses("f", 'className="text-amber-700 dark:text-amber-300 hover:bg-red-600"')).toHaveLength(3);
  });

  it("leaves tokens and unrelated words alone", () => {
    expect(rawStatusClasses("f", 'className="text-status-warning bg-status-failure-subtle" // red-team')).toEqual([]);
  });

  it("the tokens exist in light and both dark blocks", () => {
    const css = readFileSync(join(ROOT, "src/globals.css"), "utf8");
    for (const name of ["success", "warning", "failure", "unknown"]) {
      expect(css.match(new RegExp(`--status-${name}: #`, "g"))).toHaveLength(3);
      expect(css).toContain(`--color-status-${name}: var(--status-${name});`);
    }
  });
});
