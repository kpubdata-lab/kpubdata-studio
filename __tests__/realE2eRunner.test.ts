/**
 * The local real-e2e runner fails loudly and for the real reason (#840).
 *
 * The workflow sets UV_NO_SOURCES so uv resolves kpubdata from the lock's PyPI
 * pin; run locally, the runner itself has to set it on both of its uv
 * invocations, and a failing `uv run` has to be reported as what it is instead
 * of "this Builder checkout has no replay mode".
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const script = readFileSync(join(ROOT, "scripts/run-real-e2e.mjs"), "utf8");

describe("run-real-e2e.mjs", () => {
  it("sets UV_NO_SOURCES on both uv invocations", () => {
    expect(script.match(/UV_NO_SOURCES: "1"/g)).toHaveLength(2);
  });

  it("reports a failing uv run instead of blaming replay support", () => {
    expect(script).toContain("if (serveHelp.status !== 0)");
    expect(script).toContain("uv run failed");
  });
});
