/**
 * Users read "KPubData Builder", never "Engine" (#510).
 *
 * The owner's 2026-09-30 naming decision made the official names KPubData, KPubData
 * Builder and KPubData Studio, replacing #424's "KPubData Engine". This gate is #424's
 * inverted: no text a user can read — locale values, source files, the user-facing
 * documents — may call the product "Engine". It is case-sensitive, so a lowercase
 * "engine" in prose ("the execution engine") and identifiers such as `engineVersion`
 * stay allowed. CHANGELOG history is exempt: it records what was true then.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const LOCALES = join(ROOT, "src", "shared", "i18n", "locales");
const DOCUMENTS = ["README.md", "README.en.md", "PRD.md", "API_CONTRACT.md", "ARCHITECTURE.md", "INFORMATION_ARCHITECTURE.md"];
const ENGINE = /\bEngine\b/;

/** Every `path = value` whose value names Engine as the product. */
function engineMentions(tree: unknown, path = ""): string[] {
  if (typeof tree === "string") return ENGINE.test(tree) ? [`${path} = ${tree}`] : [];
  if (tree && typeof tree === "object") {
    return Object.entries(tree).flatMap(([key, value]) => engineMentions(value, path ? `${path}.${key}` : key));
  }
  return [];
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(tsx?|json)$/.test(name) ? [path] : [];
  });
}

/** `file:line` for every line that says Engine. */
function linesNamingEngine(files: string[]): string[] {
  return files.flatMap((file) =>
    readFileSync(file, "utf8")
      .split("\n")
      .flatMap((line, index) => (ENGINE.test(line) ? [`${relative(ROOT, file)}:${index + 1}`] : [])),
  );
}

describe("KPubData Builder naming gate (#510)", () => {
  it.each(["en", "ko"])("%s.json never calls the product Engine", (locale) => {
    const tree: unknown = JSON.parse(readFileSync(join(LOCALES, `${locale}.json`), "utf8"));
    expect(engineMentions(tree)).toEqual([]);
  });

  it("no source file under src/ says Engine", () => {
    expect(linesNamingEngine(sourceFiles(join(ROOT, "src")))).toEqual([]);
  });

  it("the user-facing documents never say Engine", () => {
    expect(linesNamingEngine(DOCUMENTS.map((name) => join(ROOT, name)))).toEqual([]);
  });

  describe("the check fails when it should", () => {
    it("finds Engine as a word, nested", () => {
      expect(engineMentions({ a: { b: "Engine API error" } })).toEqual(["a.b = Engine API error"]);
      expect(engineMentions({ a: "Engine이 반환한" })).toHaveLength(1);
    });

    it("leaves lowercase prose and identifiers alone", () => {
      expect(engineMentions({ a: "the execution engine", b: "engineVersion", c: "EngineError" })).toEqual([]);
    });
  });
});
