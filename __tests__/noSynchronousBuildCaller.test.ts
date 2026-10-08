/**
 * No screen sends the synchronous `POST /build` (#859 follow-up).
 *
 * An upload used to be built through it; since #786 every source goes through
 * `submitBuild`. The contract drift test lists that route's 429 as read by `buildRefusal`
 * on the ground that nothing calls it and the same reader would serve. If a caller comes
 * back, that ground is gone: its refusal has to reach the user in their language, as the
 * asynchronous route's does, and this test says so.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

describe("builderApi.build", () => {
  it("has no caller in the application", () => {
    const sources = execFileSync("git", ["ls-files", "src"], { cwd: ROOT, encoding: "utf8" })
      .split("\n")
      .filter((file) => /\.(ts|tsx)$/.test(file) && !/\.test\.tsx?$/.test(file));
    expect(sources.length).toBeGreaterThan(100);

    const callers = sources.filter((file) => /builderApi\s*\.\s*build\s*\(/.test(readFileSync(join(ROOT, file), "utf8")));

    expect(callers).toEqual([]);
  });

  it("is still there to be called, so the check above is of something", () => {
    expect(readFileSync(join(ROOT, "src/shared/lib/builderApi.ts"), "utf8")).toMatch(/^\s+build: \(specYaml: string/m);
  });
});
