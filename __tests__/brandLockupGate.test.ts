/**
 * `KPubData` leads the lockup; `Studio` is a weaker suffix (#425, VISUAL_IDENTITY §2).
 *
 * The approved lockups coloured `Studio` Indigo, the brand colour, so the suffix read
 * stronger than the family name. Each lockup's `Studio` path is now the neutral tone for
 * its surface and drawn smaller than `KPubData`. This fails if it goes back.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SVG = join(ROOT, "assets/logo/kpubdata-brand-assets/svg");
// Brand v2 (#628): Slate on light surfaces, a light neutral slate on dark ones; the suffix
// never takes a symbol colour (Brand Blue, Data Cyan, Fresh Mint).
const SUFFIX: Record<string, string> = { light: "#64748B", dark: "#94A3B8" };
const BRAND = ["#2563EB", "#06B6D4", "#14B8A6"];

/** The two wordmark paths — the only ones drawn with a scale transform — as [fill, scale]. */
export function wordmark(svg: string): Array<{ fill: string; scale: number }> {
  return [...svg.matchAll(/<path d="[^"]*" fill="([^"]+)" transform="translate\([^)]*\) scale\(([\d.]+)\)"\/>/g)].map(
    (match) => ({ fill: match[1], scale: Number(match[2]) }),
  );
}

describe("Studio is the weaker suffix in every lockup (#425)", () => {
  it.each(["horizontal_light", "horizontal_dark", "vertical_light", "vertical_dark"])("%s", (name) => {
    const [family, suffix] = wordmark(readFileSync(join(SVG, `${name}.svg`), "utf8"));
    expect(suffix.fill).toBe(SUFFIX[name.endsWith("dark") ? "dark" : "light"]);
    expect(BRAND).not.toContain(suffix.fill);
    expect(suffix.scale).toBeLessThan(family.scale);
  });

  it("would catch a brand-coloured suffix", () => {
    const old = '<path d="M0 0" fill="#172033" transform="translate(1 2) scale(0.38)"/><path d="M0 0" fill="#2563EB" transform="translate(1 3) scale(0.21)"/>';
    expect(BRAND).toContain(wordmark(old)[1].fill);
  });
});

/**
 * mkdocs reads its logo and favicon from docs_dir, so they are copies of the brand SVGs
 * (`mkdocs.yml`). A copy that is not refreshed with its source leaves the docs site on an
 * old logo (#628).
 */
const DOCS_COPIES: Array<[copy: string, source: string]> = [
  ["docs/brand/assets/favicon.svg", "favicon.svg"],
  ["docs/brand/assets/logo.svg", "symbol_light.svg"],
];

/** Docs copies whose bytes differ from their source SVG. */
export function divergedCopies(read: (path: string) => Buffer): string[] {
  return DOCS_COPIES.filter(([copy, source]) => !read(join(ROOT, copy)).equals(read(join(SVG, source)))).map(([copy]) => copy);
}

describe("the docs site's logo and favicon are byte copies of the brand SVGs (#628)", () => {
  it("every copy matches its source", () => {
    expect(divergedCopies((path) => readFileSync(path))).toEqual([]);
  });

  it("would catch a copy left on the old logo", () => {
    const stale = (path: string) => (path.endsWith(join("docs/brand/assets/logo.svg")) ? Buffer.from("<svg/>") : readFileSync(path));
    expect(divergedCopies(stale)).toEqual(["docs/brand/assets/logo.svg"]);
  });
});
