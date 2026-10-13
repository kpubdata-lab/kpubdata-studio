#!/usr/bin/env node
/**
 * Contract drift against the Builder release a Studio release pairs with (#980).
 *
 * CI checks Studio's schemas against Builder's main, which is what Studio is developed
 * against. A release pairs with Builder's tag of the same version (kpubdata ADR 0004),
 * and main has usually moved on from it — so a release that only ran the main check
 * could name a tag whose contract Studio cannot read. This runs the same drift test
 * (`src/shared/lib/contractDrift.test.ts`, plus the contract half of
 * `__tests__/publishIssueCodes.test.ts`) against the checked-out tag's contract, and
 * fails, rather than skips, when anything about that contract is off:
 *
 *   - no contract at the given path (the tag was not checked out, or has none)
 *   - its version is not the one the release read and will print in its notes
 *   - its version is below `MIN_BUILDER_API_VERSION`, the floor Studio enforces at
 *     runtime: Studio would refuse the very Builder it is released with
 *   - the drift test fails, or a drift test file is skipped as a whole
 *
 * The checks before the test run are pure (`checkPairedContract`), so the tests need no
 * Builder checkout.
 *
 * Usage:
 *   node scripts/release-contract-drift.mjs --contract .builder/contract/builder-api.yaml \
 *     --tag v0.5.0 [--expect-version 1.125.0]
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { parse } from "yaml";

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const DRIFT_TESTS = ["src/shared/lib/contractDrift.test.ts", "__tests__/publishIssueCodes.test.ts"];

const VERSION = /^(\d+)\.(\d+)\.(\d+)$/;

function compare(a, b) {
  const [x, y] = [VERSION.exec(a).slice(1).map(Number), VERSION.exec(b).slice(1).map(Number)];
  for (let i = 0; i < 3; i += 1) if (x[i] !== y[i]) return x[i] - y[i];
  return 0;
}

/** `MIN_BUILDER_API_VERSION` as `src/shared/lib/builderApi.ts` declares it. */
export function readMinimum(root = ROOT) {
  const source = readFileSync(join(root, "src", "shared", "lib", "builderApi.ts"), "utf8");
  const declared = /export const MIN_BUILDER_API_VERSION = "([0-9.]+)"/.exec(source)?.[1];
  if (!declared) throw new Error("MIN_BUILDER_API_VERSION not found in src/shared/lib/builderApi.ts");
  return declared;
}

/**
 * Whether the paired tag's contract may be tested. `contractText` is null when the file
 * does not exist. Returns `{ ok, message, version }`.
 */
export function checkPairedContract({ contractText, tag, expectVersion = "", minimum }) {
  if (contractText === null) {
    return { ok: false, message: `no Builder contract for ${tag}: check out kpubdata-builder ${tag} first` };
  }
  let version;
  try {
    version = String(parse(contractText)?.info?.version ?? "");
  } catch (error) {
    return { ok: false, message: `kpubdata-builder ${tag}: contract/builder-api.yaml does not parse (${error.message})` };
  }
  if (!VERSION.test(version)) {
    return { ok: false, message: `kpubdata-builder ${tag}: contract version ${JSON.stringify(version)} is not X.Y.Z` };
  }
  if (expectVersion && version !== expectVersion) {
    return {
      ok: false,
      message: `kpubdata-builder ${tag}: checked-out contract is ${version}, but the release read ${expectVersion}`,
    };
  }
  if (compare(version, minimum) < 0) {
    return {
      ok: false,
      message: `kpubdata-builder ${tag} serves contract ${version}, below MIN_BUILDER_API_VERSION ${minimum}: Studio would refuse the Builder it pairs with`,
    };
  }
  return { ok: true, message: `kpubdata-builder ${tag} contract ${version} (minimum ${minimum})`, version };
}

function main(argv) {
  const option = (name) => {
    const index = argv.indexOf(name);
    return index !== -1 ? argv[index + 1] : undefined;
  };
  const contract = option("--contract");
  const tag = option("--tag");
  if (!contract || !tag) {
    console.error("usage: release-contract-drift.mjs --contract <path> --tag <tag> [--expect-version X.Y.Z]");
    return 2;
  }
  const path = resolve(contract);
  const result = checkPairedContract({
    contractText: existsSync(path) ? readFileSync(path, "utf8") : null,
    tag,
    expectVersion: option("--expect-version") ?? "",
    minimum: readMinimum(),
  });
  if (!result.ok) {
    console.error(`::error::${result.message}`);
    return 1;
  }
  console.log(result.message);

  const run = spawnSync("npx", ["vitest", "run", ...DRIFT_TESTS], {
    cwd: ROOT,
    encoding: "utf8",
    env: { ...process.env, BUILDER_CONTRACT: path },
    maxBuffer: 64 * 1024 * 1024,
  });
  const output = `${run.stdout}\n${run.stderr}`;
  process.stdout.write(output);
  if (run.status !== 0) {
    console.error(`::error::Studio's schemas do not match kpubdata-builder ${tag} (contract ${result.version})`);
    return 1;
  }
  if (/Test Files\s.*skipped/.test(output)) {
    console.error(`::error::a contract drift test file was skipped against kpubdata-builder ${tag}`);
    return 1;
  }
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(main(process.argv.slice(2)));
}
