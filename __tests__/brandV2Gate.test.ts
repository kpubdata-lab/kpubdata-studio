/**
 * Brand v2 stays applied (#628, contrast #631).
 *
 * - The prototype's tokens and the app's tokens are one brand system, light and dark.
 * - Brand v1's Indigo `#5B5BD6` / Light Indigo `#818CF8` are gone from every active UI
 *   source, and the dark navy `#0F172A` is not the light theme. History (CHANGELOG, the
 *   v1 prototype, the docs that describe what Brand v2 replaced) is not read.
 * - No brand SVG uses a gradient.
 * - A saturated colour in a token source (`src/globals.css`, the prototype's `tokens.css`
 *   and pages) is one of the approved Brand v2 values; status tokens are their own system and are checked by `visualTokensGate`.
 * - The light sidebar is light, and only its active item is Brand Blue.
 * - Token pairs meet WCAG 2.1 AA: text 4.5:1, chart marks and the focus ring 3:1
 *   (docs/brand/VISUAL_IDENTITY.md §3.5). Secondary text `#5E6E84` and the strong chart
 *   variants were decided in #631.
 *
 * Each check has a case below showing it fails on the thing it guards against.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { ROOT, THEMES, contrast, luminance, type Tokens } from "./support/brandTokens";

/** Prototype token → the app token that must carry the same value. */
const DRIFT: Array<[prototype: string, app: string]> = [
  ["--brand-primary", "--brand-primary"],
  ["--brand-primary-foreground", "--brand-primary-foreground"],
  ["--brand-subtle", "--accent-subtle"],
  ["--brand-text", "--accent-subtle-foreground"],
  ["--data-accent", "--data-accent"],
  ["--data-accent-strong", "--data-accent-strong"],
  ["--brand-secondary", "--brand-secondary"],
  ["--brand-secondary-strong", "--brand-secondary-strong"],
  ["--surface-page", "--background"],
  ["--surface-card", "--card"],
  ["--surface-muted", "--muted"],
  ["--surface-sidebar", "--sidebar"],
  ["--sidebar-text", "--sidebar-foreground"],
  ["--sidebar-muted", "--sidebar-muted"],
  ["--sidebar-hover", "--sidebar-hover"],
  ["--sidebar-active", "--sidebar-active"],
  ["--sidebar-active-text", "--sidebar-active-foreground"],
  ["--text-primary", "--foreground"],
  ["--text-secondary", "--muted-foreground"],
  ["--text-muted", "--muted-foreground"],
  ["--border", "--border"],
  ...["success", "warning", "failure", "unknown"].flatMap((name): Array<[string, string]> => [
    [`--status-${name}`, `--status-${name}`],
    [`--status-${name}-subtle`, `--status-${name}-subtle`],
  ]),
];

/** `prototype → app: a ≠ b` for each mapped token whose values differ (or is missing). */
export function drift(prototype: Tokens, app: Tokens): string[] {
  return DRIFT.filter(([p, a]) => !prototype.get(p) || prototype.get(p) !== app.get(a)).map(
    ([p, a]) => `${p} → ${a}: ${prototype.get(p) ?? "missing"} ≠ ${app.get(a) ?? "missing"}`,
  );
}

/** Brand v1 values that must not come back. */
const LEGACY = ["#5b5bd6", "#818cf8"];
const LEGACY_DARK_SIDEBAR = "#0f172a";

/**
 * The approved saturated colours (VISUAL_IDENTITY §3.1, §3.4, §3.5): Brand Blue, Data
 * Cyan, Fresh Mint, their chart-strong variants, Slate (secondary text) and the lighter
 * blue used for blue text on dark surfaces. Neutrals are below the chroma threshold.
 */
const APPROVED = ["#2563eb", "#06b6d4", "#14b8a6", "#0891b2", "#0d9488", "#5e6e84", "#60a5fa"];
/** max(r,g,b) − min(r,g,b) above which a colour counts as saturated (a hue, not a neutral). */
const CHROMA = 32;

function chroma(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return Math.max(r, g, b) - Math.min(r, g, b);
}

/** `file:line #hex` for each saturated colour that is not approved. Status declarations are skipped. */
export function offPalette(file: string, source: string): string[] {
  return source.split("\n").flatMap((line, index) =>
    /--status-[\w-]+\s*:/.test(line)
      ? []
      : [...line.matchAll(/#[0-9a-f]{6}(?![0-9a-z])/gi)]
          .map((m) => m[0].toLowerCase())
          .filter((hex) => chroma(hex) > CHROMA && !APPROVED.includes(hex))
          .map((hex) => `${file}:${index + 1} ${hex}`),
  );
}

/** `file: #hex` for each legacy Brand v1 colour in the source. */
export function legacyHits(file: string, source: string): string[] {
  const lower = source.toLowerCase();
  return LEGACY.filter((hex) => lower.includes(hex)).map((hex) => `${file}: ${hex}`);
}

/** Whether an SVG paints with a gradient (or a filter standing in for one). */
export function hasGradient(svg: string): boolean {
  return /<(linear|radial)Gradient\b|gradient\(|<filter\b/i.test(svg);
}

/** Active UI sources: the app's tracked sources and the warehouse prototype's pages and styles. */
function activeSources(): string[] {
  const src = execFileSync("git", ["ls-files", "src"], { cwd: ROOT, encoding: "utf8" })
    .split("\n")
    .filter((file) => /\.(ts|tsx|css|html)$/.test(file) && !file.includes(".test."));
  const prototype = readdirSync(join(ROOT, "docs/prototype/warehouse"))
    .filter((file) => /\.(html|css)$/.test(file))
    .map((file) => `docs/prototype/warehouse/${file}`);
  return [...src, ...prototype, "index.html"];
}

const read = (file: string) => readFileSync(join(ROOT, file), "utf8");

describe("Brand v2 gate (#628)", () => {
  describe("the prototype and the app share one brand system", () => {
    it.each([
      ["light", THEMES.prototype.light, THEMES.app.light],
      ["dark", THEMES.prototype.dark, THEMES.app.dark],
    ])("%s", (_, prototype, app) => {
      expect(drift(prototype, app)).toEqual([]);
    });

    it("the OS-preference dark block matches the explicit dark block", () => {
      expect([...THEMES.app.systemDark]).toEqual([...THEMES.app.dark]);
    });

    it("would catch a prototype left on Brand v1", () => {
      const v1 = new Map(THEMES.prototype.light);
      v1.set("--brand-primary", "#5b5bd6");
      v1.set("--surface-sidebar", "#0f172a");
      expect(drift(v1, THEMES.app.light)).toEqual([
        "--brand-primary → --brand-primary: #5b5bd6 ≠ #2563eb",
        "--surface-sidebar → --sidebar: #0f172a ≠ #f1f4f4",
      ]);
    });
  });

  describe("Brand v1 colours are gone from active UI sources", () => {
    it("no #5B5BD6 or #818CF8", () => {
      expect(activeSources().flatMap((file) => legacyHits(file, read(file)))).toEqual([]);
    });

    it("the dark navy #0F172A is not in the light theme", () => {
      for (const [name, tokens] of [["app", THEMES.app.light], ["prototype", THEMES.prototype.light]] as const) {
        expect([...tokens].filter(([, value]) => value === LEGACY_DARK_SIDEBAR).map(([token]) => `${name} ${token}`)).toEqual([]);
      }
    });

    it("would catch the old accent", () => {
      expect(legacyHits("f.css", "--accent: #5B5BD6;")).toEqual(["f.css: #5b5bd6"]);
    });
  });

  describe("brand SVGs are flat", () => {
    const dirs = ["assets/logo/kpubdata-brand-assets/svg", "docs/brand/assets"];
    it.each(dirs)("%s has no gradient", (dir) => {
      const svgs = readdirSync(join(ROOT, dir)).filter((file) => file.endsWith(".svg"));
      expect(svgs.length).toBeGreaterThan(0);
      expect(svgs.filter((file) => hasGradient(read(`${dir}/${file}`)))).toEqual([]);
    });

    it("would catch a gradient", () => {
      expect(hasGradient('<svg><defs><linearGradient id="g"/></defs><path fill="url(#g)"/></svg>')).toBe(true);
      expect(hasGradient('<svg><path fill="#2563EB"/></svg>')).toBe(false);
    });
  });

  describe("saturated colours come from the approved palette", () => {
    it("in the token sources and the prototype pages", () => {
      const files = ["src/globals.css", ...activeSources().filter((file) => file.startsWith("docs/prototype/"))];
      expect(files.flatMap((file) => offPalette(file, read(file)))).toEqual([]);
    });

    it("would catch an arbitrary brand colour, but not a neutral, a status or an issue number", () => {
      const css = [
        "  --accent: #6366f1;",
        "  --muted: #f1f3ef;",
        "  --status-success: #15803d;",
        "  /* #628 */ --brand-primary: #2563EB;",
      ].join("\n");
      expect(offPalette("f.css", css)).toEqual(["f.css:1 #6366f1"]);
    });
  });

  it("the light sidebar is light and only its active item is Brand Blue", () => {
    const light = THEMES.app.light;
    expect(luminance(light.get("--sidebar")!)).toBeGreaterThan(0.8);
    expect(luminance(light.get("--sidebar-foreground")!)).toBeLessThan(0.05);
    expect(light.get("--sidebar-active-foreground")).toBe(light.get("--brand-primary"));
    expect(light.get("--sidebar-hover")).not.toBe(light.get("--sidebar-active"));
    // The active background is a tint, never a solid blue block.
    expect(luminance(light.get("--sidebar-active")!)).toBeGreaterThan(0.8);
  });
});

/** [foreground, background] token pairs and the ratio each must reach. */
type Pair = [foreground: string, background: string];

const TEXT: Pair[] = [
  ...["--background", "--card", "--muted"].flatMap((bg): Pair[] => [
    ["--foreground", bg],
    ["--muted-foreground", bg],
    ["--accent-subtle-foreground", bg],
  ]),
  ["--card-foreground", "--card"],
  ["--sidebar-foreground", "--sidebar"],
  ["--sidebar-foreground", "--sidebar-hover"],
  ["--sidebar-muted", "--sidebar"],
  ["--accent-subtle-foreground", "--sidebar"],
  ["--accent-subtle-foreground", "--accent-subtle"],
  ["--sidebar-active-foreground", "--sidebar-active"],
  ["--accent-foreground", "--accent"],
  ["--brand-primary-foreground", "--brand-primary"],
];
/** Brand Blue is the link and active text colour in the light theme. */
const LIGHT_TEXT: Pair[] = [
  ["--brand-primary", "--background"],
  ["--brand-primary", "--card"],
  ["--brand-primary", "--sidebar"],
];
const GRAPHIC: Pair[] = [
  ...["--background", "--card"].flatMap((bg): Pair[] => [
    ["--data-accent-strong", bg],
    ["--brand-secondary-strong", bg],
    ["--ring", bg],
  ]),
];

/** `fg on bg: ratio` for each pair below `min`. */
export function failingPairs(tokens: Tokens, pairs: Pair[], min: number): string[] {
  return pairs.flatMap(([fg, bg]) => {
    const [a, b] = [tokens.get(fg), tokens.get(bg)];
    if (!a || !b) return [`${fg} on ${bg}: missing`];
    const ratio = contrast(a, b);
    return ratio >= min ? [] : [`${fg} on ${bg}: ${ratio.toFixed(2)}`];
  });
}

describe("contrast gate (#631, WCAG 2.1 AA)", () => {
  it.each([
    ["light", THEMES.app.light, [...TEXT, ...LIGHT_TEXT]],
    ["dark", THEMES.app.dark, TEXT],
  ] as const)("%s: text pairs reach 4.5:1", (_, tokens, pairs) => {
    expect(failingPairs(tokens, [...pairs], 4.5)).toEqual([]);
  });

  it.each([
    ["light", THEMES.app.light],
    ["dark", THEMES.app.dark],
  ] as const)("%s: chart marks and the focus ring reach 3:1", (_, tokens) => {
    expect(failingPairs(tokens, GRAPHIC, 3)).toEqual([]);
  });

  it("computes the WCAG ratio", () => {
    expect(contrast("#000000", "#ffffff")).toBeCloseTo(21, 5);
    expect(contrast("#2563eb", "#ffffff")).toBeCloseTo(5.17, 2);
  });

  it("would fail Brand v2's first Slate and the plain Cyan and Mint as chart marks", () => {
    const before = new Map(THEMES.app.light);
    before.set("--muted-foreground", "#64748b");
    before.set("--data-accent-strong", "#06b6d4");
    before.set("--brand-secondary-strong", "#14b8a6");
    expect(failingPairs(before, [["--muted-foreground", "--background"]], 4.5)).toEqual([
      "--muted-foreground on --background: 4.46",
    ]);
    expect(failingPairs(before, GRAPHIC, 3)).toEqual([
      "--data-accent-strong on --background: 2.27",
      "--brand-secondary-strong on --background: 2.33",
      "--data-accent-strong on --card: 2.43",
      "--brand-secondary-strong on --card: 2.49",
    ]);
  });
});
