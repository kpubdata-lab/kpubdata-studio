/**
 * A release measures MIN_BUILDER_API_VERSION against the paired Builder tag's contract
 * history (#1019).
 *
 * Two cases run `scripts/contract-floor.mjs` itself on a throwaway Builder history, to
 * show it stops rather than passes: one whose newest contract Studio cannot read, and one
 * whose measured floor is above the minimum. The workflow wiring is read from the YAML;
 * nothing here runs a release.
 */
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { describe, expect, it } from "vitest";
import { parse } from "yaml";

import { ROOT, readMinimum } from "../scripts/release-contract-drift.mjs";

interface Step {
  name?: string;
  if?: string;
  with?: Record<string, string | number>;
  env?: Record<string, string>;
  run?: string;
  "continue-on-error"?: boolean | string;
}

const contractPath = process.env.BUILDER_CONTRACT;
const unreadable = (version: string) => `openapi: 3.1.0\ninfo:\n  title: t\n  version: "${version}"\npaths: {}\n`;

describe("contract-floor.mjs", () => {
  // The script runs Vitest itself; the parent run's variables must not leak into it.
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.startsWith("VITEST") && key !== "BUILDER_CONTRACT"),
  );

  /**
   * A Builder history holding `contracts` in order, oldest first, each in its own commit:
   * contract text, or a contract directory (with its fixtures) to copy.
   */
  function builderHistory(contracts: (string | { dir: string })[]): string {
    const dir = mkdtempSync(join(tmpdir(), "studio-contract-floor-test-"));
    const git = (...args: string[]) => {
      const result = spawnSync("git", ["-C", dir, "-c", "user.name=t", "-c", "user.email=t@example.invalid", ...args], {
        encoding: "utf8",
      });
      if (result.status !== 0) throw new Error(result.stderr);
    };
    git("init", "-q");
    mkdirSync(join(dir, "contract"));
    for (const [index, contract] of contracts.entries()) {
      if (typeof contract === "string") writeFileSync(join(dir, "contract", "builder-api.yaml"), contract);
      else cpSync(contract.dir, join(dir, "contract"), { recursive: true });
      git("add", "contract");
      git("commit", "-q", "-m", `contract ${index}`);
    }
    return dir;
  }

  const floor = (builderRoot: string) =>
    spawnSync(process.execPath, [join(ROOT, "scripts", "contract-floor.mjs"), "--builder-root", builderRoot, "--ref", "HEAD"], {
      cwd: ROOT,
      encoding: "utf8",
      env,
      maxBuffer: 64 * 1024 * 1024,
    });

  it("stops when the paired tag's own contract fails the drift test", { timeout: 120_000 }, () => {
    const dir = builderHistory([unreadable("99.0.0")]);
    try {
      const result = floor(dir);

      expect(result.status).toBe(1);
      expect(result.stdout).toContain("99.0.0  fails");
      expect(result.stderr).toContain("The newest contract already fails the drift test");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it.skipIf(!contractPath)(
    "stops when MIN_BUILDER_API_VERSION is below the measured floor",
    { timeout: 240_000 },
    () => {
      // A history where only the newest contract passes, so the floor is that contract.
      const newest = readFileSync(contractPath as string, "utf8");
      const version = /^ {2}version:\s*"?([0-9.]+)"?/m.exec(newest)?.[1] ?? "";
      const dir = builderHistory([unreadable("1.0.0"), { dir: dirname(contractPath as string) }]);
      try {
        const result = floor(dir);

        expect(result.stdout).toContain(`floor: ${version}   MIN_BUILDER_API_VERSION: ${readMinimum()}`);
        expect(result.status).toBe(1);
        expect(result.stderr).toContain(`raise it to ${version}`);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
  );
});

describe("release.yml measures the contract floor against the paired tag (#1019)", () => {
  const workflow = parse(readFileSync(join(ROOT, ".github/workflows/release.yml"), "utf8")) as {
    jobs: Record<string, { steps?: Step[] }>;
  };
  const steps = workflow.jobs.release.steps ?? [];
  const names = steps.map((step) => step.name);
  const step = (name: string) => steps.find((candidate) => candidate.name === name);

  it("checks out the paired tag with its whole history", () => {
    const checkout = step("Checkout Builder's contract at the paired tag");

    expect(checkout?.with?.ref).toBe("${{ steps.tag.outputs.tag }}");
    expect(checkout?.with?.path).toBe(".builder");
    expect(checkout?.with?.["fetch-depth"]).toBe(0);
  });

  it("runs contract:floor against that checkout at the paired tag", () => {
    const measure = step("Builder contract floor (paired release tag)");

    expect(measure?.env?.TAG).toBe("${{ steps.tag.outputs.tag }}");
    expect(measure?.run).toContain("npm run contract:floor");
    expect(measure?.run).toContain("--builder-root .builder");
    expect(measure?.run).toContain('--ref "${TAG}"');
  });

  it("cannot be skipped and comes before the tag", () => {
    const name = "Builder contract floor (paired release tag)";

    expect(step(name)?.if).toBeUndefined();
    expect(step(name)?.["continue-on-error"]).toBeUndefined();
    expect(names.indexOf("Checkout Builder's contract at the paired tag")).toBeLessThan(names.indexOf(name));
    expect(names.indexOf(name)).toBeGreaterThan(-1);
    expect(names.indexOf(name)).toBeLessThan(names.indexOf("Tag and release"));
  });
});
