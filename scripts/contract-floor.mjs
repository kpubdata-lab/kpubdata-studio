#!/usr/bin/env node
/**
 * Measure the oldest Builder API contract this Studio works with (#790).
 *
 * `MIN_BUILDER_API_VERSION` is meant to be measured, not remembered (#725). This takes a
 * Builder checkout, reads every version of `contract/builder-api.yaml` in its history,
 * and runs Studio's own contract drift test (`src/shared/lib/contractDrift.test.ts`)
 * against each one, newest first, until one fails. The oldest version that still passes
 * is the floor: from there up every route `builderApi` calls is declared and every
 * contract-valid response parses with Studio's schemas.
 *
 * It then compares the floor with `MIN_BUILDER_API_VERSION` and exits 1 when the
 * constant is below it — Studio would accept a Builder it cannot fully talk to. A
 * constant above the floor is reported but passes: a minimum may be raised on purpose
 * for a field the drift test does not see (see API_CONTRACT.md §3).
 *
 * Usage:
 *   node scripts/contract-floor.mjs [--builder-root ../kpubdata-builder] [--ref upstream/main]
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(name);
  return index !== -1 ? args[index + 1] : fallback;
};
const builderRoot = resolve(option("--builder-root", join(process.cwd(), "..", "kpubdata-builder")));
const ref = option("--ref", "HEAD");
const CONTRACT = "contract/builder-api.yaml";

function git(...gitArgs) {
  const result = spawnSync("git", ["-C", builderRoot, ...gitArgs], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(`git ${gitArgs.join(" ")}: ${result.stderr.trim()}`);
  return result.stdout;
}

const semver = (version) => version.split(".").map(Number);
const compare = (a, b) => {
  const [x, y] = [semver(a), semver(b)];
  for (let i = 0; i < 3; i += 1) if (x[i] !== y[i]) return x[i] - y[i];
  return 0;
};

/** Each contract version in the history, with the newest commit that carried it. */
function contractVersions() {
  const seen = new Map();
  for (const commit of git("log", "--format=%H", ref, "--", CONTRACT).split("\n").filter(Boolean)) {
    const match = /^ {2}version:\s*"?([0-9]+\.[0-9]+\.[0-9]+)"?/m.exec(git("show", `${commit}:${CONTRACT}`));
    if (match && !seen.has(match[1])) seen.set(match[1], commit);
  }
  return [...seen.entries()].sort(([a], [b]) => compare(b, a));
}

/** Run the drift test against one commit's contract directory; return the failing tests. */
function drift(commit) {
  const dir = mkdtempSync(join(tmpdir(), "studio-contract-floor-"));
  try {
    const archive = spawnSync("git", ["-C", builderRoot, "archive", commit, "contract"], { maxBuffer: 256 * 1024 * 1024 });
    spawnSync("tar", ["-x", "-C", dir], { input: archive.stdout });
    const run = spawnSync("npx", ["vitest", "run", "src/shared/lib/contractDrift.test.ts"], {
      encoding: "utf8",
      env: { ...process.env, BUILDER_CONTRACT: join(dir, CONTRACT) },
      maxBuffer: 64 * 1024 * 1024,
    });
    const output = `${run.stdout}\n${run.stderr}`;
    const failing = [...new Set([...output.matchAll(/^ FAIL .*? > (.+)$/gm)].map((m) => m[1].trim()))];
    return run.status === 0 ? [] : failing.length > 0 ? failing : ["the drift test did not run"];
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const source = readFileSync(join(process.cwd(), "src", "shared", "lib", "builderApi.ts"), "utf8");
const declared = /export const MIN_BUILDER_API_VERSION = "([0-9.]+)"/.exec(source)?.[1];
if (!declared) {
  console.error("MIN_BUILDER_API_VERSION not found in src/shared/lib/builderApi.ts");
  process.exit(2);
}

let floor = null;
for (const [version, commit] of contractVersions()) {
  const failing = drift(commit);
  if (failing.length === 0) {
    floor = version;
    console.log(`${version}  passes`);
    continue;
  }
  console.log(`${version}  fails:\n${failing.map((name) => `    - ${name}`).join("\n")}`);
  break;
}

if (floor === null) {
  console.error("\nThe newest contract already fails the drift test; fix that first.");
  process.exit(1);
}
console.log(`\nfloor: ${floor}   MIN_BUILDER_API_VERSION: ${declared}`);
if (compare(declared, floor) < 0) {
  console.error(`MIN_BUILDER_API_VERSION is below the measured floor; raise it to ${floor}.`);
  process.exit(1);
}
if (compare(declared, floor) > 0) console.log("The minimum is above the floor — say why in API_CONTRACT.md §3.");
