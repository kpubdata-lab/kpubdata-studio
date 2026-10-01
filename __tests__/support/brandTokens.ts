/**
 * Reading the Brand v2 token blocks (#628) out of `src/globals.css` and the warehouse
 * prototype's `tokens.css`, for the brand gates. Only plain custom-property declarations
 * are read; `var(--x)` is resolved inside the same block.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const GLOBALS_CSS = readFileSync(join(ROOT, "src/globals.css"), "utf8");
export const PROTOTYPE_CSS = readFileSync(join(ROOT, "docs/prototype/warehouse/tokens.css"), "utf8");

export type Tokens = Map<string, string>;

/** Custom properties declared in the block that opens with `opener` (e.g. `:root {`). */
export function block(css: string, opener: string): Tokens {
  const start = css.indexOf(opener);
  if (start === -1) throw new Error(`no block opens with ${opener}`);
  const body = css.slice(start + opener.length, css.indexOf("}", start));
  return new Map([...body.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim().toLowerCase()]));
}

/** A token's value with `var(--x)` references followed inside the block. */
export function resolve(tokens: Tokens, name: string, seen: string[] = []): string | undefined {
  const value = tokens.get(name);
  const ref = value?.match(/^var\((--[\w-]+)\)$/);
  if (!ref) return value;
  if (seen.includes(ref[1])) throw new Error(`var() cycle at ${name}`);
  return resolve(tokens, ref[1], [...seen, name]);
}

/** Every token in the block, resolved. */
export function resolved(tokens: Tokens): Tokens {
  return new Map([...tokens.keys()].map((name) => [name, resolve(tokens, name) ?? ""]));
}

/** Light and dark token sets of the app and of the prototype. */
export const THEMES = {
  app: {
    light: resolved(block(GLOBALS_CSS, ':root[data-theme="light"] {')),
    dark: resolved(block(GLOBALS_CSS, ':root[data-theme="dark"] {')),
    // The OS-preference dark block must say the same as the explicit one.
    systemDark: resolved(block(GLOBALS_CSS, ":root:not([data-theme]) {")),
  },
  prototype: {
    light: resolved(block(PROTOTYPE_CSS, ":root {")),
    dark: resolved(block(PROTOTYPE_CSS, ':root[data-theme="dark"] {')),
  },
} as const;

/** WCAG 2.1 relative luminance of a `#rrggbb` colour. */
export function luminance(hex: string): number {
  const match = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!match) throw new Error(`not a #rrggbb colour: ${hex}`);
  const [r, g, b] = [0, 2, 4].map((i) => {
    const c = parseInt(match[1].slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG 2.1 contrast ratio of two `#rrggbb` colours, 1–21. */
export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}
