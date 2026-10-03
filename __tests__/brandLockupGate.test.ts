/**
 * `KPubData` leads the lockup; `Studio` is a weaker suffix (#425, VISUAL_IDENTITY §2).
 *
 * The approved lockups coloured `Studio` Indigo, the brand colour, so the suffix read
 * stronger than the family name. Each lockup's `Studio` path is now the neutral tone for
 * its surface and drawn smaller than `KPubData`. This fails if it goes back.
 */
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { inflateSync } from "node:zlib";

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

/**
 * The symbol survives 16px (#628 §5.1, §22, §23): the K must read at favicon size with no
 * stroke collapsing into another, and every place the symbol appears draws the same K.
 *
 * Two checks. The vector one samples each symbol SVG on its 64-unit grid, so the favicon,
 * the symbol and sidebar crops, the monochrome variants and the lockups cannot drift apart,
 * and measures the strokes against the grid: at 16px one pixel is four units. The raster
 * one decodes the committed favicon PNGs, the files a browser tab actually shows, and checks
 * the stem is solid and the gap between the stem and the arms is empty.
 */
const UNIT_PX_AT_16 = 4;
const GRID = 64;
/** Units: stem x 8-20, gap x 20-24, glyph rows y 8-56 (see the comment in favicon.svg). */
const STEM = { from: 8, to: 20 };
const GAP = { from: 20, to: 24 };
const GLYPH_ROWS = { from: 8, to: 56 };

type Polygon = Array<[number, number]>;

/** The symbol's paths: the untransformed `<path d fill>` elements (wordmark paths carry a transform). */
export function symbolPaths(svg: string): Array<{ polygon: Polygon; fill: string }> {
  return [...svg.matchAll(/<path d="([^"]+)" fill="(#[0-9A-Fa-f]{6})"\/>/g)].map((match) => ({
    polygon: polygon(match[1]),
    fill: match[2].toUpperCase(),
  }));
}

/** A path of absolute M/L/H/V/Z commands as its vertices. */
export function polygon(d: string): Polygon {
  const points: Polygon = [];
  let [x, y] = [0, 0];
  for (const [, command, args] of d.matchAll(/([MLHVZ])([^MLHVZ]*)/g)) {
    const numbers = args.trim() === "" ? [] : args.trim().split(/[\s,]+/).map(Number);
    if (command === "H") x = numbers[0];
    else if (command === "V") y = numbers[0];
    else if (command === "M" || command === "L") [x, y] = numbers;
    else continue;
    points.push([x, y]);
  }
  return points;
}

function inside([px, py]: [number, number], points: Polygon): boolean {
  let hit = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const [xi, yi] = points[i];
    const [xj, yj] = points[j];
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}

/** The symbol's silhouette on the 64-unit grid, one character per unit cell. */
export function silhouette(paths: Array<{ polygon: Polygon }>): string {
  const rows: string[] = [];
  for (let y = 0; y < GRID; y++) {
    let row = "";
    for (let x = 0; x < GRID; x++) row += paths.some((p) => inside([x + 0.5, y + 0.5], p.polygon)) ? "#" : ".";
    rows.push(row);
  }
  return rows.join("\n");
}

/** Narrowest filled run, in units, across the rows a path covers. */
export function narrowestRun(points: Polygon): number {
  const ys = points.map(([, y]) => y);
  let narrowest = Infinity;
  for (let y = Math.min(...ys); y < Math.max(...ys); y++) {
    let run = 0;
    let best = 0;
    for (let x = 0; x < GRID; x++) {
      run = inside([x + 0.5, y + 0.5], points) ? run + 1 : 0;
      best = Math.max(best, run);
    }
    if (best > 0) narrowest = Math.min(narrowest, best);
  }
  return narrowest;
}

/** A non-interlaced 8-bit RGBA PNG's alpha channel as rows. */
export function pngAlpha(png: Buffer): number[][] {
  const width = png.readUInt32BE(16);
  const height = png.readUInt32BE(20);
  if (png[24] !== 8 || png[25] !== 6 || png[28] !== 0) throw new Error("expected a non-interlaced 8-bit RGBA PNG");
  const chunks: Buffer[] = [];
  for (let offset = 8; offset < png.length; ) {
    const length = png.readUInt32BE(offset);
    if (png.toString("latin1", offset + 4, offset + 8) === "IDAT") chunks.push(png.subarray(offset + 8, offset + 8 + length));
    offset += 12 + length;
  }
  const raw = inflateSync(Buffer.concat(chunks));
  const stride = width * 4;
  const rows: number[][] = [];
  let previous = new Uint8Array(stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = Uint8Array.from(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)));
    for (let i = 0; i < stride; i++) {
      const a = i >= 4 ? line[i - 4] : 0;
      const b = previous[i];
      const c = i >= 4 ? previous[i - 4] : 0;
      const p = a + b - c;
      const paeth = Math.abs(p - a) <= Math.abs(p - b) && Math.abs(p - a) <= Math.abs(p - c) ? a : Math.abs(p - b) <= Math.abs(p - c) ? b : c;
      const predictor = [0, a, b, (a + b) >> 1, paeth][filter];
      line[i] = (line[i] + predictor) & 0xff;
    }
    rows.push(Array.from({ length: width }, (_, x) => line[x * 4 + 3]));
    previous = line;
  }
  return rows;
}

function faviconAlpha(size: number): number[][] {
  return pngAlpha(readFileSync(join(ROOT, `assets/logo/kpubdata-brand-assets/png/favicon-${size}.png`)));
}

/** Where a rendered favicon breaks the K: a stem pixel not solid, a gap pixel not empty, a row with no arm. */
export function faviconProblems(alpha: number[][]): string[] {
  const size = alpha.length;
  const px = (units: number) => (units * size) / GRID;
  const problems: string[] = [];
  for (let y = 0; y < size; y++) {
    const glyphRow = y >= px(GLYPH_ROWS.from) && y < px(GLYPH_ROWS.to);
    for (let x = px(STEM.from); x < px(STEM.to); x++) {
      if (alpha[y][x] !== (glyphRow ? 255 : 0)) problems.push(`stem ${glyphRow ? "not solid" : "overflows"} at (${x}, ${y})`);
    }
    for (let x = px(GAP.from); x < px(GAP.to); x++) if (alpha[y][x] !== 0) problems.push(`gap filled at (${x}, ${y})`);
    if (glyphRow && !alpha[y].slice(px(GAP.to)).some((a) => a === 255)) problems.push(`no arm on row ${y}`);
  }
  return problems;
}

describe("the symbol is viable at 16px and the same K everywhere (#628)", () => {
  const read = (name: string) => readFileSync(join(SVG, `${name}.svg`), "utf8");
  const favicon = symbolPaths(read("favicon"));

  it("the favicon is a 64-unit grid of at most three flat symbol colours", () => {
    expect(read("favicon")).toContain(`viewBox="0 0 ${GRID} ${GRID}"`);
    expect(favicon.length).toBeGreaterThanOrEqual(2);
    expect(favicon.length).toBeLessThanOrEqual(3);
    for (const { fill } of favicon) expect(BRAND).toContain(fill);
  });

  it("no stroke is thinner than two pixels at 16px", () => {
    for (const { polygon: points } of favicon) expect(narrowestRun(points)).toBeGreaterThanOrEqual(2 * UNIT_PX_AT_16);
  });

  it("the stem is pixel-aligned and a one-pixel gap separates it from the arms", () => {
    const [stem, ...arms] = favicon;
    for (const [x, y] of stem.polygon) {
      expect(x % UNIT_PX_AT_16).toBe(0);
      expect(y % UNIT_PX_AT_16).toBe(0);
    }
    const stemRight = Math.max(...stem.polygon.map(([x]) => x));
    const armsLeft = Math.min(...arms.flatMap((arm) => arm.polygon.map(([x]) => x)));
    expect(armsLeft - stemRight).toBeGreaterThanOrEqual(UNIT_PX_AT_16);
  });

  // Swept from the directory, not listed by hand (#715): a symbol SVG added later is held to
  // the favicon's K without anyone remembering to name it here.
  const others = readdirSync(SVG)
    .filter((file) => file.endsWith(".svg") && file !== "favicon.svg")
    .map((file) => file.slice(0, -".svg".length))
    .sort();

  it("the sweep finds the symbol, sidebar, monochrome and lockup SVGs", () => {
    expect(others).toEqual(expect.arrayContaining(["symbol_light", "sidebar_dark", "symbol_mono_ink", "horizontal_light"]));
    expect(others).not.toContain("favicon");
  });

  it.each(others)("%s draws the favicon's K", (name) => {
    expect(silhouette(symbolPaths(read(name)))).toBe(silhouette(favicon));
  });

  it.each([16, 32])("favicon-%ipx.png keeps a solid stem, an empty gap and an arm on every row", (size) => {
    expect(faviconProblems(faviconAlpha(size))).toEqual([]);
  });

  describe("the checks fail when they should", () => {
    it("sees a stroke thinned below two pixels", () => {
      expect(narrowestRun(polygon("M8 8H12V56H8Z"))).toBeLessThan(2 * UNIT_PX_AT_16);
    });

    it("sees an arm drawn differently from the favicon", () => {
      const moved = favicon.map((path, i) => (i === 2 ? { ...path, polygon: polygon("M24 32L36 8H52L40 32Z") } : path));
      expect(silhouette(moved)).not.toBe(silhouette(favicon));
    });

    it("sees the stem and the arms merging at 16px", () => {
      const merged = faviconAlpha(16).map((row) => [...row]);
      merged[8][5] = 255;
      expect(faviconProblems(merged)).toEqual(["gap filled at (5, 8)"]);
    });
  });
});
