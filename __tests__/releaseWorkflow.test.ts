/**
 * What a release reads and where it may be cut from (#481).
 *
 * The release notes state the Builder contract version "this release pairs with". It was
 * read from Builder's main, so the notes named a tag and showed another commit's
 * version. And a dispatch from any branch was gated, tagged and released as if it were
 * main. These hold the two rules in `release.yml`; they do not run a release.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { parse } from "yaml";
import { describe, expect, it } from "vitest";

interface Step {
  name?: string;
  env?: Record<string, string>;
  run?: string;
}

const WORKFLOW = join(dirname(fileURLToPath(import.meta.url)), "..", ".github", "workflows", "release.yml");
const workflow = parse(readFileSync(WORKFLOW, "utf8")) as { jobs: { release: { if: string; steps: Step[] } } };
const release = workflow.jobs.release;

describe("release.yml (#481)", () => {
  it("runs a dispatched release only from main", () => {
    const dispatch = release.if.split("||")[0];

    expect(dispatch).toContain("github.event_name == 'workflow_dispatch'");
    expect(dispatch).toContain("github.ref == 'refs/heads/main'");
  });

  it("reads Builder's contract at the tag being released, not at its main", () => {
    const step = release.steps.find((candidate) => candidate.name === "Read the Builder API contract version");

    expect(step?.env?.TAG).toBe("${{ steps.tag.outputs.tag }}");
    expect(step?.run).toContain("contents/contract/builder-api.yaml?ref=${TAG}");
    // Every API read of the contract in the job names the ref.
    const reads = release.steps.flatMap((candidate) => candidate.run?.match(/contents\/contract\/builder-api\.yaml[^\s"]*/g) ?? []);
    expect(reads.length).toBeGreaterThan(0);
    expect(reads.filter((read) => !read.includes("?ref="))).toEqual([]);
  });

  it("stops before tagging when the paired contract cannot be read", () => {
    const names = release.steps.map((candidate) => candidate.name);
    const step = release.steps.find((candidate) => candidate.name === "Read the Builder API contract version");

    expect(step?.run).not.toContain("unknown");
    expect(step?.run?.match(/exit 1/g)?.length).toBe(2);
    expect(names.indexOf("Read the Builder API contract version")).toBeLessThan(names.indexOf("Tag and release"));
  });
});
