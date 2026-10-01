/**
 * The screenshot baselines are refreshed in the Playwright image for the installed
 * `@playwright/test` (#532).
 *
 * A different Chromium renders text and anti-aliasing differently, so the image tag in
 * `test:e2e:update-visual` has to follow the package. A pull request that bumps
 * `@playwright/test` without the tag fails here, which is the reminder to refresh the
 * baselines in the same pull request.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as {
  scripts: Record<string, string>;
  devDependencies: Record<string, string>;
};

describe("visual baseline image (#532)", () => {
  it("pins @playwright/test to an exact version", () => {
    expect(pkg.devDependencies["@playwright/test"]).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("updates baselines in the Playwright image of that version", () => {
    const version = pkg.devDependencies["@playwright/test"];
    expect(pkg.scripts["test:e2e:update-visual"]).toContain(`mcr.microsoft.com/playwright:v${version}-noble`);
  });

  it("the spec header names the same image", () => {
    const spec = readFileSync(join(ROOT, "e2e", "visual.spec.ts"), "utf8");
    expect(spec).toContain(`mcr.microsoft.com/playwright:v${pkg.devDependencies["@playwright/test"]}-noble`);
  });
});
