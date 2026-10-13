/**
 * A release runs the contract drift test against the Builder tag it pairs with, not
 * Builder's main (#980).
 *
 * The pure checks are fed contract text directly; two cases run the script itself, one
 * with no contract and one with a contract Studio cannot read, to show it stops rather
 * than skips. The workflow wiring is read from the YAML; nothing here runs a release.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";
import { parse } from "yaml";

import { ROOT, checkPairedContract, readMinimum } from "../scripts/release-contract-drift.mjs";

interface Step {
  name?: string;
  id?: string;
  if?: string;
  uses?: string;
  with?: Record<string, string>;
  env?: Record<string, string>;
  run?: string;
  "continue-on-error"?: boolean | string;
}
type Workflow = { jobs: Record<string, { steps?: Step[] }> };

function load(name: string): Workflow {
  return parse(readFileSync(join(ROOT, ".github/workflows", name), "utf8")) as Workflow;
}

const contract = (version: string) => `openapi: 3.1.0\ninfo:\n  title: t\n  version: "${version}"\npaths: {}\n`;

describe("checkPairedContract", () => {
  it("fails when the paired tag's contract is not there", () => {
    const result = checkPairedContract({ contractText: null, tag: "v0.9.0", minimum: "1.96.0" });

    expect(result.ok).toBe(false);
    expect(result.message).toContain("v0.9.0");
  });

  it("fails when the checked-out contract is not the version the release read", () => {
    const result = checkPairedContract({
      contractText: contract("1.120.0"),
      tag: "v0.9.0",
      expectVersion: "1.125.0",
      minimum: "1.96.0",
    });

    expect(result.ok).toBe(false);
    expect(result.message).toContain("1.120.0");
    expect(result.message).toContain("1.125.0");
  });

  it("fails when the paired contract is below MIN_BUILDER_API_VERSION", () => {
    // v0.4.0's tag held 1.29.0 while main held 1.76.0 (#481).
    const result = checkPairedContract({ contractText: contract("1.29.0"), tag: "v0.4.0", minimum: "1.96.0" });

    expect(result.ok).toBe(false);
    expect(result.message).toContain("MIN_BUILDER_API_VERSION");
  });

  it("fails on a contract version that is not X.Y.Z", () => {
    expect(checkPairedContract({ contractText: contract("next"), tag: "v0.9.0", minimum: "1.96.0" }).ok).toBe(false);
  });

  it("passes a contract at or above the minimum that matches what the release read", () => {
    const result = checkPairedContract({
      contractText: contract("1.125.0"),
      tag: "v0.9.0",
      expectVersion: "1.125.0",
      minimum: "1.96.0",
    });

    expect(result).toMatchObject({ ok: true, version: "1.125.0" });
  });

  it("reads the minimum Studio enforces", () => {
    expect(readMinimum()).toMatch(/^\d+\.\d+\.\d+$/);
  });
});

describe("release-contract-drift.mjs", () => {
  // The script runs Vitest itself; the parent run's variables must not leak into it.
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.startsWith("VITEST") && key !== "BUILDER_CONTRACT"),
  );
  const run = (contractPath: string, tag: string) =>
    spawnSync(
      process.execPath,
      [join(ROOT, "scripts", "release-contract-drift.mjs"), "--contract", contractPath, "--tag", tag],
      { cwd: ROOT, encoding: "utf8", env, maxBuffer: 64 * 1024 * 1024 },
    );

  it("stops when the paired tag was not checked out", () => {
    const result = run(join(tmpdir(), "no-such-builder", "contract", "builder-api.yaml"), "v9.9.9");

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("no Builder contract for v9.9.9");
  });

  it("stops on a paired contract Studio cannot read, whatever Builder main says", { timeout: 120_000 }, () => {
    const dir = mkdtempSync(join(tmpdir(), "studio-release-drift-"));
    try {
      // Above the minimum, so only the drift test itself can refuse it.
      const path = join(dir, "builder-api.yaml");
      writeFileSync(path, `${contract("99.0.0")}components:\n  schemas: {}\n`);

      const result = run(path, "v99.0.0");

      expect(result.status).toBe(1);
      expect(result.stderr).toContain("Studio's schemas drift from kpubdata-builder v99.0.0");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("release.yml runs drift against the paired tag (#980)", () => {
  const steps = load("release.yml").jobs.release.steps ?? [];
  const names = steps.map((step) => step.name);
  const step = (name: string) => steps.find((candidate) => candidate.name === name);

  it("checks out Builder's contract at the tag being released", () => {
    const checkout = step("Checkout Builder's contract at the paired tag");

    expect(checkout?.with?.repository).toBe("kpubdata-lab/kpubdata-builder");
    expect(checkout?.with?.ref).toBe("${{ steps.tag.outputs.tag }}");
    expect(checkout?.with?.path).toBe(".builder");
    // Every Builder checkout in the release job names the tag; none reads main.
    const builderCheckouts = steps.filter((candidate) => candidate.with?.repository === "kpubdata-lab/kpubdata-builder");
    expect(builderCheckouts.map((candidate) => candidate.with?.ref)).toEqual(["${{ steps.tag.outputs.tag }}"]);
  });

  it("runs the drift test against that checkout, with the version the notes will print", () => {
    const drift = step("Builder contract drift (paired release tag)");

    expect(drift?.env?.TAG).toBe("${{ steps.tag.outputs.tag }}");
    expect(drift?.env?.API).toBe("${{ steps.contract.outputs.api }}");
    expect(drift?.run).toContain("node scripts/release-contract-drift.mjs");
    expect(drift?.run).toContain("--contract .builder/contract/builder-api.yaml");
    expect(drift?.run).toContain('--tag "${TAG}"');
    expect(drift?.run).toContain('--expect-version "${API}"');
  });

  it("runs the whole suite with the paired contract", () => {
    expect(step("Run quality gates")?.env?.BUILDER_CONTRACT).toBe(".builder/contract/builder-api.yaml");
  });

  it("cannot be skipped and comes before the tag", () => {
    for (const name of ["Checkout Builder's contract at the paired tag", "Builder contract drift (paired release tag)"]) {
      expect(step(name)?.if, name).toBeUndefined();
      expect(step(name)?.["continue-on-error"], name).toBeUndefined();
    }
    expect(names.indexOf("Read the Builder API contract version")).toBeLessThan(
      names.indexOf("Builder contract drift (paired release tag)"),
    );
    expect(names.indexOf("Checkout Builder's contract at the paired tag")).toBeLessThan(
      names.indexOf("Builder contract drift (paired release tag)"),
    );
    expect(names.indexOf("Builder contract drift (paired release tag)")).toBeLessThan(names.indexOf("Tag and release"));
  });
});

describe("ci.yml keeps main drift and adds the paired tag on release pull requests (#980)", () => {
  const steps = load("ci.yml").jobs.test.steps ?? [];
  const step = (name: string) => steps.find((candidate) => candidate.name === name);
  const RELEASE_PR = "matrix.coverage && startsWith(github.head_ref, 'release/')";

  it("still checks every pull request against Builder main", () => {
    const main = steps.find((candidate) => candidate.name === "Checkout Builder's contract");

    expect(main?.with?.repository).toBe("kpubdata-lab/kpubdata-builder");
    expect(main?.with?.ref).toBeUndefined();
    expect(step("Builder contract drift (Builder main)")?.env?.BUILDER_CONTRACT).toBe(
      ".builder/contract/builder-api.yaml",
    );
  });

  it("checks a release pull request against the tag it pairs with, under its own step name", () => {
    expect(step("Read the paired Builder tag")?.if).toBe(RELEASE_PR);
    expect(step("Read the paired Builder tag")?.run).toContain("require('./package.json').version");

    const checkout = step("Checkout Builder's contract at the paired tag");
    expect(checkout?.if).toBe(RELEASE_PR);
    expect(checkout?.with?.ref).toBe("${{ steps.paired.outputs.tag }}");
    expect(checkout?.with?.path).toBe(".builder-release");

    const drift = step("Builder contract drift (paired release tag)");
    expect(drift?.if).toBe(RELEASE_PR);
    expect(drift?.env?.TAG).toBe("${{ steps.paired.outputs.tag }}");
    expect(drift?.run).toContain("--contract .builder-release/contract/builder-api.yaml");
    expect(drift?.["continue-on-error"]).toBeUndefined();
  });
});
