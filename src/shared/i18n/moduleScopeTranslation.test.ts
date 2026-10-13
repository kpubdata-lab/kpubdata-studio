/**
 * Gate: no `i18n.t(...)` runs when a module is evaluated (#978).
 *
 * The locale chunks load after the entry chunk (#796), so a translation made at module
 * scope can capture a key identifier instead of text, and never follows a language change.
 * Translate inside a function, called when the text is shown or used.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { describe, expect, it } from "vitest";

/** `file:line` of every `i18n.t(...)` call not inside a function, in `text`. */
function moduleScopeTranslations(file: string, text: string): string[] {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const found: string[] = [];
  const visit = (node: ts.Node, inFunction: boolean): void => {
    const inside = inFunction || ts.isFunctionLike(node);
    if (!inside && ts.isCallExpression(node) && node.expression.getText(source) === "i18n.t") {
      found.push(`${file}:${source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1}`);
    }
    ts.forEachChild(node, (child) => visit(child, inside));
  };
  visit(source, false);
  return found;
}

describe("module-scope translation gate (#978)", () => {
  it("finds a module-scope call and ignores one inside a function", () => {
    const text = [
      'const WARNING = i18n.t("a.b");',
      'const LIST = [i18n.t("a.c")];',
      'const later = () => i18n.t("a.d");',
      'function f() { return i18n.t("a.e"); }',
    ].join("\n");
    expect(moduleScopeTranslations("x.ts", text)).toEqual(["x.ts:1", "x.ts:2"]);
  });

  it("no non-test module under src translates at module scope", () => {
    const files = execFileSync("git", ["ls-files", "src"], { encoding: "utf8" })
      .split("\n")
      .filter((file) => /\.tsx?$/.test(file) && !/\.test\.tsx?$/.test(file) && !file.includes("__tests__"));
    expect(files.length).toBeGreaterThan(0);
    const found = files.flatMap((file) => moduleScopeTranslations(file, readFileSync(file, "utf8")));
    expect(found).toEqual([]);
  });
});
