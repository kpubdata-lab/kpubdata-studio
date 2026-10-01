/**
 * CodeQL leaves test files out and scans the rest of src/ (#617).
 *
 * Secret-shaped fixtures in tests were followed into production sinks and reported as
 * clear-text storage. The Security workflow's CodeQL job reads
 * `.github/codeql/codeql-config.yml`, whose `paths-ignore` must match test files only:
 * a pattern that also matched a production file would hide real findings in it.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";
import { parse } from "yaml";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");
const CONFIG = ".github/codeql/codeql-config.yml";

/** The subset of CodeQL's glob syntax the config uses: `**`, `*` and literals. */
function globToRegExp(glob: string): RegExp {
  let out = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*" && glob[i + 1] === "*") {
      if (glob[i + 2] === "/") {
        out += "(?:.*/)?";
        i += 2;
      } else {
        out += ".*";
        i += 1;
      }
    } else if (c === "*") {
      out += "[^/]*";
    } else {
      out += c.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
    }
  }
  return new RegExp(`^${out}$`);
}

const isTestFile = (path: string) =>
  /\.test\.tsx?$/.test(path) || path.startsWith("__tests__/") || path.startsWith("e2e/");

/** Production files under src/ that one of the patterns would leave out of the analysis. */
function hiddenProductionFiles(patterns: string[], files: string[]): string[] {
  const res = patterns.map(globToRegExp);
  return files.filter((f) => f.startsWith("src/") && !isTestFile(f) && res.some((re) => re.test(f)));
}

const config = parse(read(CONFIG)) as { "paths-ignore"?: string[] };
const patterns = config["paths-ignore"] ?? [];
const files = execFileSync("git", ["ls-files"], { cwd: ROOT, encoding: "utf8" }).split("\n").filter(Boolean);
const ignored = (path: string) => patterns.some((p) => globToRegExp(p).test(path));

describe("CodeQL config (#617)", () => {
  it("is the config the Security workflow's CodeQL job reads", () => {
    const security = parse(read(".github/workflows/security.yml")) as {
      jobs: { codeql: { steps: { uses?: string; with?: Record<string, string> }[] } };
    };
    const init = security.jobs.codeql.steps.find((s) => s.uses?.startsWith("github/codeql-action/init@"));
    expect(init?.with?.["config-file"]).toBe(`./${CONFIG}`);
    expect(existsSync(join(ROOT, CONFIG))).toBe(true);
  });

  it("leaves every test file out", () => {
    const tests = files.filter(isTestFile).filter((f) => /\.(ts|tsx|js|mjs)$/.test(f));
    expect(tests.length).toBeGreaterThan(0);
    expect(tests.filter((f) => !ignored(f))).toEqual([]);
    expect(ignored("src/features/build-spec/specRoundTrip.test.ts")).toBe(true);
  });

  it("scans every production file under src/", () => {
    expect(files.some((f) => f === "src/features/build-spec/draftStorage.ts")).toBe(true);
    expect(hiddenProductionFiles(patterns, files)).toEqual([]);
  });

  it("would catch a pattern that hides production code", () => {
    expect(hiddenProductionFiles(["src/features/**"], files)).toContain("src/features/build-spec/draftStorage.ts");
    expect(hiddenProductionFiles(["**/*.ts"], files)).toContain("src/features/build-spec/draftStorage.ts");
  });
});
