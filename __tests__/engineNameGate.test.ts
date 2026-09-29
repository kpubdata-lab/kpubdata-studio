/**
 * Users read "KPubData Engine", never "Builder" (studio#424).
 *
 * `kpubdata-builder` is a repository and package name; the product is KPubData Engine
 * (kpubdata docs/brand/BRAND.md). Every locale value is something a user can read, so
 * none may say "Builder". Environment variable names like `VITE_USE_REAL_BUILDER` are
 * configuration identifiers, not the product's name, and are upper case — the check
 * is case-sensitive for that reason.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const LOCALES = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "shared", "i18n", "locales");

/** Every `path = value` whose value names Builder as the product. */
function builderMentions(tree: unknown, path = ""): string[] {
  if (typeof tree === "string") return /\bBuilder\b/.test(tree) ? [`${path} = ${tree}`] : [];
  if (tree && typeof tree === "object") {
    return Object.entries(tree).flatMap(([key, value]) => builderMentions(value, path ? `${path}.${key}` : key));
  }
  return [];
}

describe("KPubData Engine naming gate (#424)", () => {
  it.each(["en", "ko"])("%s.json never calls the product Builder", (locale) => {
    const tree: unknown = JSON.parse(readFileSync(join(LOCALES, `${locale}.json`), "utf8"));
    expect(builderMentions(tree)).toEqual([]);
  });

  describe("the check fails when it should", () => {
    it("finds Builder as a word, nested", () => {
      expect(builderMentions({ a: { b: "Builder API error" } })).toEqual(["a.b = Builder API error"]);
      expect(builderMentions({ a: "Builder가 반환한" })).toHaveLength(1);
    });

    it("leaves configuration identifiers and the package name alone", () => {
      expect(builderMentions({ a: "Set VITE_USE_REAL_BUILDER=true", b: "kpubdata-builder 0.4.0", c: "BuildSpec" })).toEqual([]);
    });
  });
});
