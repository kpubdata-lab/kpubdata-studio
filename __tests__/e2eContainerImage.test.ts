/**
 * CI's E2E job runs in the Playwright image for the installed `@playwright/test` (#585).
 *
 * The image carries the browsers that version of Playwright drives. A bump of the package
 * without the image tag would run a newer Playwright against browsers it does not know,
 * and render screenshots in a different Chromium than the baselines were made in. This
 * fails the pull request that moves one without the other.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");

const pkg = JSON.parse(read("package.json")) as { devDependencies: Record<string, string> };
const lock = JSON.parse(read("package-lock.json")) as {
  packages: Record<string, { version?: string } | undefined>;
};
const version = pkg.devDependencies["@playwright/test"];

/** The body of one job in ci.yml: from `  <name>:` to the next top-level job key. */
function jobBlock(workflow: string, name: string): string {
  const start = workflow.search(new RegExp(`^  ${name}:\\s*$`, "m"));
  expect(start, `job ${name} in ci.yml`).toBeGreaterThanOrEqual(0);
  const rest = workflow.slice(start + 1);
  const next = rest.search(/^ {2}[A-Za-z0-9_-]+:\s*$/m);
  return next === -1 ? rest : rest.slice(0, next);
}

describe("E2E container image (#585)", () => {
  const e2e = jobBlock(read(".github/workflows/ci.yml"), "e2e");

  it("pins @playwright/test to an exact version", () => {
    expect(version).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("installs that version of every Playwright package", () => {
    for (const name of ["@playwright/test", "playwright", "playwright-core"]) {
      expect(lock.packages[`node_modules/${name}`]?.version, name).toBe(version);
    }
  });

  it("runs the E2E job in the Playwright image of that version", () => {
    const images = [...e2e.matchAll(/mcr\.microsoft\.com\/playwright:v([^\s"']+)/g)].map((m) => m[1]);
    expect(images).toEqual([`${version}-noble`]);
    expect(e2e).toMatch(/^ {4}container:\s*$/m);
  });

  it("does not download browsers the image already has", () => {
    expect(e2e).not.toMatch(/playwright install/);
  });
});
