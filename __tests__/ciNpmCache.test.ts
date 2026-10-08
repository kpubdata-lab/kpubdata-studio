/**
 * `npm ci` installs from the cache `setup-node` restores (#836).
 *
 * `setup-node` with `cache: npm` saves and restores npm's default cache directory. A
 * step that points `npm_config_cache` somewhere else installs from an empty directory
 * every time and leaves the restored one unused, which is what six install steps did.
 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const WORKFLOWS = join(dirname(fileURLToPath(import.meta.url)), "..", ".github", "workflows");

/** The lines of a workflow that move npm's cache, as `line number: text`. */
function cacheOverrides(source: string): string[] {
  return source
    .split("\n")
    .map((line, index) => `${index + 1}: ${line.trim()}`)
    .filter((line) => /^\d+: (npm_config_cache|NPM_CONFIG_CACHE)\s*:/.test(line));
}

describe("npm's cache in CI", () => {
  it("no workflow moves it away from the directory setup-node saves", () => {
    const found = readdirSync(WORKFLOWS)
      .filter((name) => /\.ya?ml$/.test(name))
      .flatMap((name) => cacheOverrides(readFileSync(join(WORKFLOWS, name), "utf8")).map((line) => `${name}:${line}`));
    expect(found).toEqual([]);
  });

  it("the check finds an override, and leaves the temporary directory alone", () => {
    const step = [
      "      - run: npm ci",
      "        env:",
      "          npm_config_cache: ${{ runner.temp }}/.npm-cache",
      "          npm_config_tmp: ${{ runner.temp }}/.npm-tmp",
    ].join("\n");
    expect(cacheOverrides(step)).toEqual(["3: npm_config_cache: ${{ runner.temp }}/.npm-cache"]);
  });
});
