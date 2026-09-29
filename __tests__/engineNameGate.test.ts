/**
 * Users read "KPubData Builder", never "Engine" (studio#510).
 *
 * The product names are KPubData, KPubData Builder and KPubData Studio. studio#424
 * renamed Builder to "KPubData Engine"; #510 restores Builder, so "Engine" is now the
 * stale product name. Every locale value is something a user can read, so none may say
 * "Engine" or its Korean form "엔진". The check is case-sensitive: a lower-case "engine"
 * describing something generic is not the product's name.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const LOCALES = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "shared", "i18n", "locales");

/** Every `path = value` whose value names Engine as the product. */
function engineMentions(tree: unknown, path = ""): string[] {
  if (typeof tree === "string") return /\bEngine\b|엔진/.test(tree) ? [`${path} = ${tree}`] : [];
  if (tree && typeof tree === "object") {
    return Object.entries(tree).flatMap(([key, value]) => engineMentions(value, path ? `${path}.${key}` : key));
  }
  return [];
}

describe("KPubData Builder naming gate (#510)", () => {
  it.each(["en", "ko"])("%s.json never calls the product Engine", (locale) => {
    const tree: unknown = JSON.parse(readFileSync(join(LOCALES, `${locale}.json`), "utf8"));
    expect(engineMentions(tree)).toEqual([]);
  });

  describe("the check fails when it should", () => {
    it("finds Engine as a word, nested, and the Korean form", () => {
      expect(engineMentions({ a: { b: "Engine API error" } })).toEqual(["a.b = Engine API error"]);
      expect(engineMentions({ a: "KPubData Engine이 반환한" })).toHaveLength(1);
      expect(engineMentions({ a: "실행 엔진에 연결" })).toHaveLength(1);
    });

    it("leaves Builder, identifiers and generic lower-case words alone", () => {
      expect(
        engineMentions({ a: "KPubData Builder API", b: "Set VITE_USE_REAL_BUILDER=true", c: "a query engine", d: "BuildSpec" }),
      ).toEqual([]);
    });
  });
});
