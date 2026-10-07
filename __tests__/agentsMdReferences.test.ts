/**
 * What AGENTS.md tells an agent to run exists (#811).
 *
 * AGENTS.md told agents to run the release workflow with `dry_run`, an input
 * `release.yml` never had (its default `mode=prepare` opens a real release pull
 * request), and to propose a version bump, which Studio cannot choose: `prepare` writes
 * Builder's newest release. These checks read the file the way an agent does and ask
 * the repository whether each thing it names is there.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";
import { parse } from "yaml";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const AGENTS = readFileSync(join(ROOT, "AGENTS.md"), "utf8");
const WORKFLOWS = join(ROOT, ".github", "workflows");

/** [line, match] for each backticked match of `pattern` in AGENTS.md. */
function named(pattern: string): Array<[string, string]> {
  return AGENTS.split("\n").flatMap((line) =>
    [...line.matchAll(new RegExp("`(" + pattern + ")`", "g"))].map((m): [string, string] => [line, m[1]]),
  );
}

describe("AGENTS.md references", () => {
  it("names only scripts that exist (kpubdata's are named as such)", () => {
    const scripts = named("scripts/[\\w./-]+\\.(?:py|mjs|ts|sh)(?: [^`]*)?")
      .filter(([line]) => !line.includes("kpubdata's") && !line.includes("(in kpubdata)"))
      .map(([, path]) => path.split(" ")[0]);
    expect(scripts.length).toBeGreaterThan(0);
    expect(scripts.filter((path) => !existsSync(join(ROOT, path)))).toEqual([]);
  });

  it("names only workflows that exist", () => {
    const workflows = new Set(named("[\\w-]+\\.yml").map(([, name]) => name));
    expect(workflows.has("release.yml")).toBe(true);
    expect([...workflows].filter((name) => !existsSync(join(WORKFLOWS, name)))).toEqual([]);
  });

  it("names only release inputs release.yml takes", () => {
    const release = parse(readFileSync(join(WORKFLOWS, "release.yml"), "utf8")) as {
      on: { workflow_dispatch: { inputs: Record<string, unknown> } };
    };
    const inputs = new Set(Object.keys(release.on.workflow_dispatch.inputs));
    const mentioned = named("[a-z]+(?:_[a-z]+)*(?:=[\\w-]+)?")
      .filter(([line]) => line.includes("dispatch") || line.includes("release workflow"))
      .map(([, token]) => token)
      .filter((token) => token.includes("_") || token.includes("="))
      .map((token) => token.split("=")[0]);
    expect(mentioned.length).toBeGreaterThan(0);
    expect(mentioned.filter((input) => !inputs.has(input))).toEqual([]);
    expect(AGENTS).not.toContain("dry_run");
    // Studio's version is Builder's: there is no bump to choose.
    expect(inputs.has("bump")).toBe(false);
  });

  it("describes the comment gate CI runs", () => {
    const ci = readFileSync(join(WORKFLOWS, "ci.yml"), "utf8");
    const command = "scripts/check_korean_ts_comments.py src e2e";
    expect(ci).toContain(`run: python3 ${command}`);
    expect(AGENTS).toContain(`\`${command}\``);
  });
});
