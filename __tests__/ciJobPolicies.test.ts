/**
 * CI's cancellation and timeout policy (#833).
 *
 * Only a pull request's newer push replaces that pull request's earlier run — a
 * merge to main must finish and leave its result behind. And every job that can
 * hold a runner says how long it may hold it, so a wedged step cannot sit on the
 * default six hours.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";
import { parse } from "yaml";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

type Job = Record<string, unknown> & { "timeout-minutes"?: number };
type Workflow = {
  concurrency?: { group?: string; "cancel-in-progress"?: string | boolean };
  jobs: Record<string, Job>;
};

function load(name: string): Workflow {
  return parse(readFileSync(join(ROOT, ".github/workflows", name), "utf8")) as Workflow;
}

describe("run cancellation", () => {
  it("cancels only a pull request's own run in ci.yml and security.yml", () => {
    for (const name of ["ci.yml", "security.yml"]) {
      expect(load(name).concurrency?.["cancel-in-progress"], name).toBe(
        "${{ github.event_name == 'pull_request' }}",
      );
    }
  });

  // Runs that share a group replace one another while they wait, whatever
  // cancel-in-progress says: of three quick merges the second's run would be cancelled
  // before it started. Only a pull request's runs may share one.
  it("gives every run that is not a pull request's a group of its own", () => {
    for (const name of ["ci.yml", "security.yml"]) {
      expect(load(name).concurrency?.group, name).toContain(
        "${{ github.event_name == 'pull_request' && github.ref || github.run_id }}",
      );
    }
  });
});

describe("job timeouts", () => {
  it("every job in ci.yml, deploy.yml and security.yml declares one", () => {
    for (const name of ["ci.yml", "deploy.yml", "security.yml"]) {
      const missing = Object.entries(load(name).jobs)
        .filter(([, job]) => !("timeout-minutes" in job))
        .map(([jobName]) => jobName);
      expect(missing, name).toEqual([]);
    }
  });
});
