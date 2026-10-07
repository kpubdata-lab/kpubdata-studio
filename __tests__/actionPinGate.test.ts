/**
 * The workflow action pin gate has to actually refuse (#729).
 *
 * A gate nobody has watched fail is a gate nobody knows works, so most of these feed it
 * a movable reference and expect a violation. The script is also run as a process, the
 * way CI runs it, against a fixture file and against this repository's workflows.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ROOT, bumpKpubdata, check, defaultPaths } from "../scripts/check-action-pins.mjs";

const SCRIPT = join(ROOT, "scripts", "check-action-pins.mjs");
const SHA = "807c21f6a78f22b6ed64e19b38585225ec95e1f7";
const OTHER_SHA = "3d3c42e5aac5ba805825da76410c181273ba90b1";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "action-pins-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function workflow(steps: string): string {
  const path = join(dir, "wf.yml");
  writeFileSync(path, `jobs:\n  a:\n    steps:\n${steps}`);
  return path;
}

function run(...args: string[]) {
  return spawnSync(process.execPath, [SCRIPT, ...args], { encoding: "utf8" });
}

describe("check", () => {
  it.each([
    "      - uses: kpubdata-lab/kpubdata/.github/actions/r3-review@main\n",
    "        uses: kpubdata-lab/kpubdata/.github/actions/release-notes@main\n",
    "      - uses: actions/checkout@v7\n",
    "      - uses: actions/checkout@v7.0.1  # v7.0.1\n",
    '      - uses: "actions/setup-node@v7"\n',
    "      - uses: 'actions/upload-artifact@v7'\n",
    // A short SHA can be ambiguous and is resolved like a ref name.
    "      - uses: actions/checkout@3d3c42e\n",
    "      - uses: actions/checkout\n",
    "      - uses: docker://alpine:3.20\n",
    "    uses: org/repo/.github/workflows/reusable.yml@main\n",
  ])("refuses a movable reference: %s", (line) => {
    const violations = check([workflow(line)]);

    expect(violations).toHaveLength(1);
    expect(violations[0].line).toBe(4);
  });

  it.each([
    `      - uses: kpubdata-lab/kpubdata/.github/actions/r3-review@${SHA}  # main\n`,
    `      - uses: actions/checkout@${OTHER_SHA}  # v7.0.1\n`,
    `      - uses: "actions/checkout@${OTHER_SHA}"\n`,
    "    uses: ./.github/workflows/reusable.yml\n",
    `      - uses: docker://alpine@sha256:${"a".repeat(64)}\n`,
    // Not a step: text that only mentions a ref is not run.
    "      - run: echo 'uses: actions/checkout@v7'\n",
    "      # - uses: actions/checkout@v7\n",
  ])("passes a pinned or local reference: %s", (line) => {
    expect(check([workflow(line)])).toEqual([]);
  });

  it("finds nothing movable in this repository's workflows", () => {
    const paths = defaultPaths();

    expect(paths.some((p) => p.endsWith("release.yml"))).toBe(true);
    expect(check(paths)).toEqual([]);
  });
});

describe("bumpKpubdata", () => {
  it("moves every kpubdata action and nothing else, once", () => {
    const path = workflow(
      "      - uses: kpubdata-lab/kpubdata/.github/actions/r3-review@main\n" +
        `      - uses: kpubdata-lab/kpubdata/.github/actions/release-notes@${OTHER_SHA}  # old\n` +
        `      - uses: actions/checkout@${OTHER_SHA}  # v7.0.1\n`,
    );

    expect(bumpKpubdata([path], SHA)).toEqual([path]);

    const text = readFileSync(path, "utf8");
    expect(text.split(`@${SHA}  # kpubdata-lab/kpubdata main\n`)).toHaveLength(3);
    expect(text).toContain(`actions/checkout@${OTHER_SHA}  # v7.0.1\n`);
    expect(check([path])).toEqual([]);
    expect(bumpKpubdata([path], SHA)).toEqual([]);
  });

  it.each(["main", "807c21f", SHA.toUpperCase(), `${SHA}0`, ""])("refuses %j as the commit", (sha) => {
    const path = workflow("      - uses: kpubdata-lab/kpubdata/.github/actions/x@main\n");

    expect(() => bumpKpubdata([path], sha)).toThrow(/full 40-character/);
    expect(readFileSync(path, "utf8")).toContain("@main");
  });
});

describe("the script", () => {
  it("exits 1 and names the line for a movable reference", () => {
    const path = workflow("      - uses: actions/checkout@v7\n");
    const result = run(path);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(`${path}:4: actions/checkout@v7`);
  });

  it("exits 0 for this repository", () => {
    expect(run().status).toBe(0);
  });

  it("exits 2 when --bump-kpubdata is not given a full SHA", () => {
    const path = workflow("      - uses: kpubdata-lab/kpubdata/.github/actions/x@main\n");

    expect(run("--bump-kpubdata", "main", path).status).toBe(2);
  });
});
