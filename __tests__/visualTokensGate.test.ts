/**
 * Brand colour and status colour stay apart (studio#425).
 *
 * docs/brand/VISUAL_IDENTITY.md §3.2: if success is painted in the brand indigo, the
 * brand comes to mean "success". The tokens live in the prototype stylesheet until
 * the app adopts them, so that is what this reads. Warning, stale and partial share
 * amber on purpose — which is why every badge must also carry a word.
 */

import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "docs", "prototype", "warehouse");
const CSS = readFileSync(join(DIR, "tokens.css"), "utf8");

const BRAND = ["--brand-primary", "--brand-subtle", "--brand-ink", "--data-accent"];
const STATUS = ["--status-success", "--status-warning", "--status-failure", "--status-unknown"];

/** Custom properties declared in the first block whose selector matches. */
function tokens(css: string, selector: string): Map<string, string> {
  const start = css.indexOf(`${selector} {`);
  if (start === -1) return new Map();
  const body = css.slice(start, css.indexOf("}", start));
  return new Map([...body.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim().toLowerCase()]));
}

/** Status tokens whose value equals a brand token's value. */
function collisions(values: Map<string, string>): string[] {
  const brand = new Set(BRAND.map((name) => values.get(name)).filter(Boolean));
  return STATUS.filter((name) => brand.has(values.get(name)));
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

describe("visual tokens gate (#425)", () => {
  it.each([":root", ':root[data-theme="dark"]'])("%s: no status colour equals a brand colour", (selector) => {
    const values = tokens(CSS, selector);
    for (const name of STATUS) expect(values.has(name), `${selector} ${name}`).toBe(true);
    expect(collisions(values)).toEqual([]);
  });

  it("stale and partial are amber like warning, so they must be told apart by label", () => {
    const light = tokens(CSS, ":root");
    expect(light.get("--status-stale")).toBe("var(--status-warning)");
    expect(light.get("--status-partial")).toBe("var(--status-warning)");
  });

  it("every badge in the prototypes carries a word", () => {
    for (const file of readdirSync(DIR).filter((f) => f.endsWith(".html"))) {
      expect(wordlessBadges(readFileSync(join(DIR, file), "utf8")), file).toEqual([]);
    }
  });

  describe("the checks fail when they should", () => {
    it("sees a status token painted in the brand colour", () => {
      const values = new Map([
        ["--brand-primary", "#5b5bd6"],
        ["--status-success", "#5b5bd6"],
        ["--status-failure", "#b91c1c"],
      ]);
      expect(collisions(values)).toEqual(["--status-success"]);
    });

    it("sees a badge with no word", () => {
      expect(wordlessBadges('<span class="badge stale"><span class="axis"></span></span>')).toHaveLength(1);
      expect(wordlessBadges('<span class="badge stale"><b>Stale</b></span>')).toHaveLength(1);
      expect(wordlessBadges('<span class="badge stale"><span class="axis">Health </span>Stale</span>')).toHaveLength(0);
    });
  });
});
