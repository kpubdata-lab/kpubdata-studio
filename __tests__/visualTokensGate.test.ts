/**
 * Brand colour and status colour stay apart (studio#425, Brand v2 #628).
 *
 * docs/brand/VISUAL_IDENTITY.md §3.2: if success is painted in a brand colour, the brand
 * comes to mean "success" — Fresh Mint especially, which is green-blue. Every brand, data
 * and secondary token (the chart-strong variants included) must differ from every
 * `--status-*` value, in the app (`src/globals.css`) and in the prototype stylesheet, light
 * and dark. Warning, stale and partial share amber on purpose — which is why every badge
 * must also carry a word.
 */

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { PROTOTYPE_CSS, ROOT, THEMES, block, type Tokens } from "./support/brandTokens";

const DIR = join(ROOT, "docs", "prototype", "warehouse");

const BRAND = [
  "--brand-primary",
  "--brand-subtle",
  "--brand-ink",
  "--brand-secondary",
  "--brand-secondary-strong",
  "--data-accent",
  "--data-accent-strong",
  "--accent",
  "--accent-subtle",
];
const REQUIRED_BRAND = ["--brand-primary", "--brand-secondary", "--brand-secondary-strong", "--data-accent", "--data-accent-strong"];
const STATUS = ["--status-success", "--status-warning", "--status-failure", "--status-unknown"];

/** `name = value` for each brand token whose (resolved) value equals some `--status-*` value. */
function collisions(values: Tokens): string[] {
  const status = new Map([...values].filter(([name]) => name.startsWith("--status-")).map(([name, value]) => [value, name]));
  return BRAND.filter((name) => values.has(name) && status.has(values.get(name)!)).map(
    (name) => `${name} = ${status.get(values.get(name)!)}`,
  );
}

/**
 * Badges that do not carry a word — colour alone would carry the meaning.
 *
 * A badge is `<span class="badge …"><span class="axis">Axis </span>Word</span>`. Every
 * badge must have that shape and a non-empty word; one that does not match the shape
 * counts as wordless too, so a new markup cannot slip past by looking different.
 */
function wordlessBadges(html: string): string[] {
  const opened = html.match(/<span class="badge [\w-]+">/g) ?? [];
  const words = [...html.matchAll(/<span class="badge [\w-]+"><span class="axis">[^<]*<\/span>([^<]*)<\/span>/g)].map(
    (m) => m[1].trim(),
  );
  const unmatched = opened.length - words.length;
  return [...words.filter((word) => word === ""), ...Array<string>(Math.max(unmatched, 0)).fill("")];
}

describe("visual tokens gate (#425, #628)", () => {
  const sets: Array<[string, Tokens]> = [
    ["app light", THEMES.app.light],
    ["app dark", THEMES.app.dark],
    ["app system dark", THEMES.app.systemDark],
    ["prototype light", THEMES.prototype.light],
    ["prototype dark", THEMES.prototype.dark],
  ];

  it.each(sets)("%s: no brand, data or secondary colour equals a status colour", (_, values) => {
    for (const name of [...STATUS, ...REQUIRED_BRAND]) expect(values.has(name), name).toBe(true);
    expect(collisions(values)).toEqual([]);
  });

  it("stale and partial are amber like warning, so they must be told apart by label", () => {
    const light = block(PROTOTYPE_CSS, ":root {");
    expect(light.get("--status-stale")).toBe("var(--status-warning)");
    expect(light.get("--status-partial")).toBe("var(--status-warning)");
  });

  it("every badge in the prototypes carries a word", () => {
    for (const file of readdirSync(DIR).filter((f) => f.endsWith(".html"))) {
      expect(wordlessBadges(readFileSync(join(DIR, file), "utf8")), file).toEqual([]);
    }
  });

  describe("the checks fail when they should", () => {
    it("sees a status token painted in a brand colour", () => {
      const values = new Map([
        ["--brand-primary", "#2563eb"],
        ["--status-success", "#2563eb"],
        ["--status-failure", "#b91c1c"],
      ]);
      expect(collisions(values)).toEqual(["--brand-primary = --status-success"]);
    });

    it("sees Fresh Mint, or its chart variant, used as success", () => {
      const values = new Map([
        ["--brand-secondary", "#14b8a6"],
        ["--brand-secondary-strong", "#0d9488"],
        ["--status-success", "#15803d"],
        ["--status-success-solid", "#0d9488"],
      ]);
      expect(collisions(values)).toEqual(["--brand-secondary-strong = --status-success-solid"]);
    });

    it("sees a badge with no word", () => {
      expect(wordlessBadges('<span class="badge stale"><span class="axis"></span></span>')).toHaveLength(1);
      expect(wordlessBadges('<span class="badge stale"><b>Stale</b></span>')).toHaveLength(1);
      expect(wordlessBadges('<span class="badge stale"><span class="axis">Health </span>Stale</span>')).toHaveLength(0);
    });
  });
});
