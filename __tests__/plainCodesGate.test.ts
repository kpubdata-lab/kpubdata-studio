/**
 * The plain-codes gate has to actually fail (kpubdata#878, #894).
 *
 * A review level (R0..R3) or verification level (V0..V5) is written meaning first, code
 * in parentheses. The Python checker is loaded as a module for the line-level cases and
 * run as a process, the way CI runs it, for the repository-level ones.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPT = join(ROOT, "scripts", "check_plain_codes.py");

/** The codes the checker finds in each text, one list per text. */
function codes(texts: string[], changelog = false): string[][] {
  const program = [
    "import importlib.util, json, sys",
    "spec = importlib.util.spec_from_file_location('c', sys.argv[1])",
    "m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)",
    "texts = json.load(sys.stdin)",
    "print(json.dumps([[c for _, c, _ in m.bare_codes(t, changelog=sys.argv[2] == '1')] for t in texts]))",
  ].join("\n");
  const out = execFileSync(
    "python3",
    ["-c", program, SCRIPT, changelog ? "1" : "0"],
    {
      input: JSON.stringify(texts),
      encoding: "utf8",
    },
  );
  return JSON.parse(out) as string[][];
}

describe("bare codes are found", () => {
  const cases: [string, string[]][] = [
    ["Required Verification: V2\n", ["V2"]],
    ["이 변경은 R3 로 취급한다.\n", ["R3"]],
    ["| #461 | High | V2+V3 |\n", ["V2", "V3"]],
    ["needs V5-replay before merge\n", ["V5-replay"]],
    ["R0~R3 정의\n", ["R0", "R3"]],
    ["| (V2) |\n", ["V2"]],
    ["see [R3](docs/other.md)\n", ["R3"]],
    ["<!-- plain-codes: off -->\nV1\n<!-- plain-codes: on -->\nV2\n", ["V2"]],
    ["```\nV1\n```\nV2\n", ["V2"]],
  ];
  it.each(cases)("%j", (text, expected) => {
    expect(codes([text])[0]).toEqual(expected);
  });
});

describe("glossed or literal codes pass", () => {
  const passing = [
    "단위 테스트(V1)\n",
    "unit tests (V1)\n",
    "계약·통합 테스트(V2+V3), 영향 데이터셋은 실제 API 검증(V4)\n",
    "리뷰 수준(R0~R3) 정의\n",
    "the required `R3 review` check\n",
    "the label review:R3 stays\n",
    "see [R3](docs/governance/POLICY.md#codes)\n",
    "Cloudflare R2 bucket\n",
    "API v2 and v3 and utf-8\n",
    "kpubdata-R2 and 1.V2 and R4 and V6 and R10 and V12\n",
    "```text\nRequired Verification: V4\n```\n",
    "<!-- plain-codes: off -->\n| V1 | 단위 테스트 |\n<!-- plain-codes: on -->\n",
  ];
  it.each(passing)("%j", (text) => {
    expect(codes([text])[0]).toEqual([]);
  });
});

it("checks the changelog in its Unreleased section only", () => {
  const text =
    "# Changelog\n\nV0 intro\n\n## [Unreleased]\n\n- bare V2\n\n## [0.9.0]\n\n- old R3\n";
  expect(codes([text], true)[0]).toEqual(["V2"]);
});

describe("as a process", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "plain-codes-"));
    execFileSync("git", ["init", "-q", dir]);
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function track(files: Record<string, string>): void {
    for (const [name, text] of Object.entries(files)) {
      mkdirSync(dirname(join(dir, name)), { recursive: true });
      writeFileSync(join(dir, name), text);
    }
    execFileSync("git", ["-C", dir, "add", "--", ...Object.keys(files)]);
  }
  const run = (...args: string[]) =>
    spawnSync("python3", [SCRIPT, "--root", dir, ...args], {
      encoding: "utf8",
    });

  it("fails on a tracked document and an issue form with a bare code", () => {
    track({
      "docs/plan.md": "Required Verification: 단위 테스트(V1)\n",
      ".github/ISSUE_TEMPLATE/bug.yml": "description: needs V2\n",
    });
    const result = run();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(".github/ISSUE_TEMPLATE/bug.yml:1: V2");
    expect(result.stderr).not.toContain("docs/plan.md");
  });

  it("does not read an untracked document", () => {
    track({ "README.md": "단위 테스트(V1)\n" });
    writeFileSync(join(dir, "scratch.md"), "bare V2\n");
    expect(run().status).toBe(0);
  });

  it("treats no tracked document as a failure, not a pass", () => {
    track({ "code.py": "x = 1\n" });
    expect(run().status).toBe(1);
  });

  it("treats a named file that does not exist as a failure", () => {
    track({ "README.md": "단위 테스트(V1)\n" });
    const result = run("README.md", "docs/missing.md");
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("docs/missing.md: no such file");
  });
});

it("passes on this repository", () => {
  const result = spawnSync("python3", [SCRIPT, "--root", ROOT], {
    encoding: "utf8",
  });
  expect(result.status, result.stderr).toBe(0);
});
