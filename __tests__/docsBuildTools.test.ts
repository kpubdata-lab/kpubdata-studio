/**
 * The docs are built with the same tools on a pull request and on main (#835).
 *
 * ci.yml's `docs` job is what a pull request is held to, and deploy.yml's `site` job is
 * what publishes the site. If the two install mkdocs differently, a pull request can pass
 * and the deploy from main can still fail `mkdocs build --strict`.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";
import { parse } from "yaml";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

type Workflow = {
  jobs: Record<string, { if?: string; needs?: string | string[]; steps?: Array<{ run?: string }> }>;
};

function load(name: string): Workflow {
  return parse(readFileSync(join(ROOT, ".github/workflows", name), "utf8")) as Workflow;
}

/** The `run` lines of a job, in order. */
function runs(workflow: Workflow, job: string): string[] {
  return (workflow.jobs[job]?.steps ?? []).flatMap((step) => (typeof step.run === "string" ? [step.run.trim()] : []));
}

describe("the docs build", () => {
  const ci = load("ci.yml");
  const deploy = load("deploy.yml");
  const installs = (lines: string[]) => lines.filter((line) => line.startsWith("pip install"));

  it("installs the same thing in ci.yml and deploy.yml", () => {
    expect(installs(runs(ci, "docs"))).toHaveLength(1);
    expect(installs(runs(deploy, "site"))).toEqual(installs(runs(ci, "docs")));
  });

  it("is strict in both", () => {
    expect(runs(ci, "docs")).toContain("mkdocs build --strict");
    expect(runs(deploy, "site")).toContain("mkdocs build --strict");
  });

  it("is a job the CI gate waits for", () => {
    expect(ci.jobs.gate?.needs).toContain("docs");
  });

  it("builds the site only off a pull request, and still reports `build` on one", () => {
    // `build` is a required check until an administrator removes it (#835): it must exist
    // on a pull request, and what it reports there is the CI gate's job, not its own.
    expect(deploy.jobs.site?.if).toBe("github.event_name != 'pull_request'");
    expect(deploy.jobs.build?.needs).toBe("site");
    expect(deploy.jobs.build?.if).toBe("always()");
    expect(runs(deploy, "build").join("\n")).not.toMatch(/npm|mkdocs|pip/);
    expect(deploy.jobs.deploy?.needs).toBe("site");
  });
});
