/**
 * Studio's version follows Builder's, and the two gates have to actually refuse
 * (kpubdata ADR 0004, kpubdata#895).
 *
 * The CI gate compares package.json with Builder's newest release; the release job
 * requires Builder to hold the tag being released. Both are fed fake lookups here, so
 * nothing reaches the network. The workflow wiring is read from the YAML.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";
import { parse } from "yaml";

import {
  ROOT,
  compareWithBuilder,
  main,
  parseVersion,
  readStudioVersion,
  requireBuilderTag,
  type Lookup,
} from "../scripts/check-builder-version.mjs";

interface Step {
  name?: string;
  run?: string;
  env?: Record<string, string>;
}
type Workflow = { jobs: Record<string, { needs?: string[]; steps?: Step[] }> };

function load(name: string): Workflow {
  return parse(readFileSync(join(ROOT, ".github/workflows", name), "utf8")) as Workflow;
}

function lookup(latest: string, tags: string[] = []): Lookup {
  return { latestTag: () => latest, hasTag: (tag) => tags.includes(tag) };
}

afterEach(() => {
  vi.restoreAllMocks();
});

function quiet() {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
}

describe("parseVersion", () => {
  it.each([
    ["0.4.0", [0, 4, 0]],
    ["v1.12.3", [1, 12, 3]],
  ])("reads %s", (text, expected) => {
    expect(parseVersion(text)).toEqual(expected);
  });

  it.each(["", "0.4", "v0.4.0-rc.1", "latest"])("refuses %j", (text) => {
    expect(parseVersion(text)).toBeNull();
  });
});

describe("compareWithBuilder (the CI gate)", () => {
  it("passes when Studio matches Builder's newest release", () => {
    expect(compareWithBuilder({ studioVersion: "0.4.0", builderTag: "v0.4.0" }).ok).toBe(true);
    expect(compareWithBuilder({ studioVersion: "0.4.0", builderTag: "v0.4.0", headRef: "release/v0.4.0" }).ok).toBe(true);
  });

  it("fails when Studio is ahead of Builder", () => {
    for (const studioVersion of ["0.5.0", "0.4.1", "1.0.0"]) {
      const result = compareWithBuilder({ studioVersion, builderTag: "v0.4.0" });
      expect(result.ok, studioVersion).toBe(false);
      expect(result.message).toContain("ahead of");
    }
  });

  it("fails when a release pull request names another version than Builder's", () => {
    const result = compareWithBuilder({ studioVersion: "0.4.0", builderTag: "v0.5.0", headRef: "release/v0.4.0" });
    expect(result.ok).toBe(false);
    expect(result.message).toContain("release pull request");
  });

  it("allows being behind outside a release pull request, with a warning", () => {
    const result = compareWithBuilder({ studioVersion: "0.4.0", builderTag: "v0.5.0", headRef: "fix/issue-1-x" });
    expect(result.ok).toBe(true);
    expect(result.warning).toBe(true);
  });

  it("fails when Builder has no release, or a version is malformed", () => {
    expect(compareWithBuilder({ studioVersion: "0.4.0", builderTag: "" }).ok).toBe(false);
    expect(compareWithBuilder({ studioVersion: "0.4.0", builderTag: "nightly" }).ok).toBe(false);
    expect(compareWithBuilder({ studioVersion: "0.4", builderTag: "v0.4.0" }).ok).toBe(false);
  });
});

describe("requireBuilderTag (the release job)", () => {
  it("passes when Builder has the tag", () => {
    expect(requireBuilderTag({ studioVersion: "0.4.0", tagExists: true }).ok).toBe(true);
  });

  it("fails when Builder has no such tag, naming it", () => {
    const result = requireBuilderTag({ studioVersion: "0.5.0", tagExists: false });
    expect(result.ok).toBe(false);
    expect(result.message).toContain("no tag v0.5.0");
  });
});

describe("main", () => {
  it("exits 0 on a match and 1 when Studio is ahead", () => {
    quiet();
    expect(main([], { lookup: lookup("v0.4.0"), studioVersion: "0.4.0" })).toBe(0);
    expect(main([], { lookup: lookup("v0.4.0"), studioVersion: "0.5.0" })).toBe(1);
  });

  it("reads the release branch from --head-ref", () => {
    quiet();
    expect(main(["--head-ref", "release/v0.4.0"], { lookup: lookup("v0.5.0"), studioVersion: "0.4.0" })).toBe(1);
    expect(main(["--head-ref", "fix/x"], { lookup: lookup("v0.5.0"), studioVersion: "0.4.0" })).toBe(0);
  });

  it("uses --builder-tag without asking GitHub", () => {
    quiet();
    const latestTag = vi.fn(() => "v9.9.9");
    expect(main(["--builder-tag", "v0.4.0"], { lookup: { latestTag, hasTag: () => false }, studioVersion: "0.4.0" })).toBe(0);
    expect(latestTag).not.toHaveBeenCalled();
  });

  it("--require-tag exits 1 when Builder lacks the tag and 0 when it has it", () => {
    quiet();
    expect(main(["--require-tag"], { lookup: lookup("v0.4.0", ["v0.4.0"]), studioVersion: "0.5.0" })).toBe(1);
    expect(main(["--require-tag"], { lookup: lookup("v0.4.0", ["v0.4.0"]), studioVersion: "0.4.0" })).toBe(0);
  });

  it("fails, not passes, when GitHub cannot be read", () => {
    quiet();
    const broken: Lookup = {
      latestTag: () => {
        throw new Error("network down");
      },
      hasTag: () => {
        throw new Error("network down");
      },
    };
    expect(main([], { lookup: broken, studioVersion: "0.4.0" })).toBe(1);
    expect(main(["--require-tag"], { lookup: broken, studioVersion: "0.4.0" })).toBe(1);
  });

  it("refuses an unknown argument", () => {
    quiet();
    expect(main(["--bump"], { lookup: lookup("v0.4.0"), studioVersion: "0.4.0" })).toBe(2);
  });

  it("reads package.json's version", () => {
    expect(parseVersion(readStudioVersion())).not.toBeNull();
  });
});

describe("wiring", () => {
  it("runs the comparison inside a job the CI gate waits for, with the head ref", () => {
    const ci = load("ci.yml");
    const holder = Object.entries(ci.jobs).find(([, job]) =>
      job.steps?.some((step) => step.run === "node scripts/check-builder-version.mjs"),
    );
    expect(holder).toBeDefined();
    const [jobName, job] = holder!;
    expect(ci.jobs.gate.needs).toContain(jobName);
    const step = job.steps!.find((candidate) => candidate.run === "node scripts/check-builder-version.mjs")!;
    expect(step.env?.HEAD_REF).toBe("${{ github.head_ref }}");
    expect(step.env?.GH_TOKEN).toBeDefined();
  });

  it("requires Builder's tag in the release job before anything is tagged", () => {
    const steps = load("release.yml").jobs.release.steps!;
    const names = steps.map((step) => step.name);
    const index = steps.findIndex((step) => step.run === "node scripts/check-builder-version.mjs --require-tag");
    expect(index).toBeGreaterThan(names.indexOf("Read the version being released"));
    expect(index).toBeLessThan(names.indexOf("The tag must not exist yet"));
    expect(index).toBeLessThan(names.indexOf("Tag and release"));
    expect(steps[index].env?.GH_TOKEN).toBeDefined();
  });
});
