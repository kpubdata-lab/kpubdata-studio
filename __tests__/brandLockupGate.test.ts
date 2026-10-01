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

const SVG = join(dirname(fileURLToPath(import.meta.url)), "..", "assets/logo/kpubdata-brand-assets/svg");
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
