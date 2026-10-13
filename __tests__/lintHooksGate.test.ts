/**
 * The React Hooks and floating-promise lint rules have to actually fail (#982).
 *
 * `npm run lint` passes on main because the debt that existed when the rules were
 * turned on is frozen in eslint-suppressions.json. A green lint therefore proves
 * nothing about the rules themselves, so this test lints deliberate violations in
 * __tests__/lint-fixtures/ with the repository's own config and checks that ESLint
 * rejects them, accepts their well-formed counterpart, and holds the baseline in
 * both directions: one violation more fails, and one fewer fails until pruned.
 */

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, describe, expect, it } from "vitest";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const ESLINT = join(ROOT, "node_modules", "eslint", "bin", "eslint.js");
const BAD = "__tests__/lint-fixtures/hookViolations.tsx";
const CLEAN = "__tests__/lint-fixtures/clean.tsx";

const scratch = mkdtempSync(join(tmpdir(), "lint-hooks-gate-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

type Counts = Record<string, Record<string, { count: number }>>;

/** Run ESLint the way `npm run lint` does, on one fixture, and return exit code and output. */
function lint(file: string, suppressions?: Counts): { code: number; out: string } {
  const args = [ESLINT, "--max-warnings", "0", "--no-ignore"];
  if (suppressions) {
    const location = join(scratch, `suppressions-${Math.random().toString(36).slice(2)}.json`);
    writeFileSync(location, JSON.stringify(suppressions));
    args.push("--suppressions-location", location);
  }
  args.push(file);
  try {
    const out = execFileSync("node", args, { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    return { code: 0, out };
  } catch (error) {
    const e = error as { status?: number; stdout?: string; stderr?: string };
    return { code: e.status ?? 1, out: `${e.stdout ?? ""}${e.stderr ?? ""}` };
  }
}

const BAD_RULES = [
  "react-hooks/rules-of-hooks",
  "react-hooks/exhaustive-deps",
  "react-hooks/set-state-in-effect",
  "@typescript-eslint/no-floating-promises",
];

function covering(overrides: Record<string, number> = {}): Counts {
  const rules: Record<string, { count: number }> = {};
  for (const rule of BAD_RULES) rules[rule] = { count: overrides[rule] ?? 1 };
  return { [BAD]: rules };
}

describe("React Hooks and floating-promise lint gate (#982)", () => {
  it("rejects a new hook misuse, a missing dependency and an unhandled promise", () => {
    const { code, out } = lint(BAD);
    expect(code).toBe(1);
    for (const rule of BAD_RULES) expect(out).toContain(rule);
  }, 60_000);

  it("accepts the well-formed counterpart", () => {
    const { code, out } = lint(CLEAN);
    expect(out).toBe("");
    expect(code).toBe(0);
  }, 60_000);

  it("passes when the baseline holds exactly the violations present", () => {
    expect(lint(BAD, covering()).code).toBe(0);
  }, 60_000);

  it("fails on one violation more than the baseline holds", () => {
    const { code, out } = lint(BAD, covering({ "@typescript-eslint/no-floating-promises": 0 }));
    expect(code).toBe(1);
    expect(out).toContain("@typescript-eslint/no-floating-promises");
  }, 60_000);

  it("fails when a fixed violation is left in the baseline", () => {
    const stale = { [CLEAN]: { "@typescript-eslint/no-floating-promises": { count: 1 } } };
    const { code, out } = lint(CLEAN, stale);
    expect(code).not.toBe(0);
    expect(out).toContain("--prune-suppressions");
  }, 60_000);

  it("freezes no Rules of Hooks violation in the committed baseline", () => {
    const baseline = JSON.parse(readFileSync(join(ROOT, "eslint-suppressions.json"), "utf8")) as Counts;
    const offenders = Object.keys(baseline).filter((file) => "react-hooks/rules-of-hooks" in baseline[file]);
    expect(offenders).toEqual([]);
  });
});
