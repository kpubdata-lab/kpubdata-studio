/**
 * No screen text names a build-time variable (#412).
 *
 * Settings told a user to "set VITE_USE_REAL_BUILDER=true", and the login error named
 * `VITE_OIDC_ISSUER`. A `VITE_*` name is read when the bundle is built: a user cannot
 * set one, and an operator of the release image cannot either — the container reads
 * `BUILDER_API_URL`, `OIDC_ISSUER` and the like. So no locale value and no page may
 * spell one out.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..");
const BUILD_VARIABLE = /VITE_[A-Z*]/;

function leaves(node: unknown, path: string[] = []): Array<[string, string]> {
  if (typeof node === "string") return [[path.join("."), node]];
  if (node === null || typeof node !== "object") return [];
  return Object.entries(node).flatMap(([key, value]) => leaves(value, [...path, key]));
}

describe("build-time variable names stay off the screen", () => {
  it.each(["ko", "en"])("no %s locale value names a VITE_ variable", (locale) => {
    const dictionary: unknown = JSON.parse(
      readFileSync(join(ROOT, "src/shared/i18n/locales", `${locale}.json`), "utf8"),
    );
    const values = leaves(dictionary);
    expect(values.length).toBeGreaterThan(1000);
    expect(values.filter(([, value]) => BUILD_VARIABLE.test(value)).map(([key]) => key)).toEqual([]);
  });

  it("no page or app-shell component writes one outside `import.meta.env` and comments", () => {
    const files = execFileSync("git", ["ls-files", "src/pages", "src/app"], { cwd: ROOT, encoding: "utf8" })
      .split("\n")
      .filter((file) => file.endsWith(".tsx") && !file.endsWith(".test.tsx"));
    expect(files).toContain("src/pages/SettingsPage.tsx");
    const offenders = files.flatMap((file) =>
      readFileSync(join(ROOT, file), "utf8")
        .split("\n")
        .map((line, index) => ({ line, where: `${file}:${index + 1}` }))
        .filter(({ line }) => {
          const code = line.replace(/import\.meta\.env\.VITE_[A-Z_]+/g, "");
          const trimmed = code.trim();
          if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")) return false;
          return BUILD_VARIABLE.test(code);
        })
        .map(({ where }) => where),
    );
    expect(offenders).toEqual([]);
  });

  it("the pattern catches what Settings used to show", () => {
    expect(BUILD_VARIABLE.test("VITE_USE_REAL_BUILDER=true로 설정하세요.")).toBe(true);
    expect(BUILD_VARIABLE.test("공용 API 키를 VITE_* 환경변수로 주입하지 마세요")).toBe(true);
    expect(BUILD_VARIABLE.test("OIDC_ISSUER 와 OIDC_CLIENT_ID")).toBe(false);
  });
});
