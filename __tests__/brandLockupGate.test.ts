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
const SUFFIX: Record<string, string> = { light: "#71717A", dark: "#94A3B8" };
const BRAND = ["#5B5BD6", "#818CF8"];

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

  it("would catch an Indigo suffix", () => {
    const old = '<path d="M0 0" fill="#18181B" transform="translate(1 2) scale(0.38)"/><path d="M0 0" fill="#5B5BD6" transform="translate(1 3) scale(0.21)"/>';
    expect(BRAND).toContain(wordmark(old)[1].fill);
  });
});
