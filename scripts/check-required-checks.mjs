/**
 * Every required status check must be one a workflow actually produces (#416).
 *
 * `#413` took Node 20 out of the CI matrix. Branch protection still required
 * `Lint, type check, test, build (20)`, and that context simply stopped existing.
 * GitHub does not treat an absent check as a failure — it waits. Every pull request
 * sat at BLOCKED with nothing to look at, and the only way past was `--admin`, which
 * bypasses every *other* check as well. A rule that blocks everything protects
 * nothing, and it took a session of `--admin` merges before anyone asked why.
 *
 * The aggregate `CI gate` job removes the coupling that caused it. This script is
 * what notices if the coupling comes back.
 *
 * It runs locally, not in CI, and that is deliberate: reading branch protection needs
 * an admin token, and a workflow holding one is a larger risk than the drift it would
 * catch. `gh` already has the right credential on a maintainer's machine.
 *
 * Usage:
 *   node scripts/check-required-checks.mjs                      # this repository
 *   node scripts/check-required-checks.mjs owner/repo [...]     # just print theirs
 *   node scripts/check-required-checks.mjs --required "A" "B"   # check a set by hand
 *
 * The third form takes the required set as arguments instead of reading it from
 * GitHub. It is how this script is tested — asking it about a context that no longer
 * exists has to fail, and proving that must not mean editing live branch protection.
 *
 * Each context is its own argument, never a comma-separated list. The context that
 * caused #416 is spelled `Lint, type check, test, build (20)`: splitting on commas
 * would turn the one name this script exists to catch into four names it invents.
 */
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const WORKFLOWS = new URL("../.github/workflows", import.meta.url).pathname;

function gh(args) {
  return execFileSync("gh", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

/**
 * The status-check contexts this repository's workflows can produce.
 *
 * A job's context is its `name`, or its id when it has none. A matrix job produces one
 * context per combination, spelled `name (v1, v2)`, so the matrix values are expanded
 * rather than guessed at.
 */
function producedContexts(dir) {
  const contexts = new Set();
  for (const file of readdirSync(dir).filter((f) => /\.ya?ml$/.test(f))) {
    const text = readFileSync(join(dir, file), "utf8");
    // A small hand-rolled reader, because pulling in a YAML parser for three fields
    // would make this script something a maintainer has to install before running.
    const jobs = text.split(/\n(?=jobs:)/)[1];
    if (!jobs) continue;
    for (const block of jobs.split(/\n {2}(?=[A-Za-z_][\w-]*:)/).slice(1)) {
      const id = block.match(/^([A-Za-z_][\w-]*):/)?.[1];
      if (!id) continue;
      const name = block.match(/^\s{4}name:\s*(.+)$/m)?.[1]?.trim().replace(/^["']|["']$/g, "");
      const base = name ?? id;
      const axes = [...block.matchAll(/^\s{8}([\w-]+):\s*\[([^\]]+)\]/gm)].map(([, , values]) =>
        values.split(",").map((v) => v.trim().replace(/^["']|["']$/g, "")),
      );
      if (axes.length === 0) {
        contexts.add(base);
        continue;
      }
      let combos = [[]];
      for (const axis of axes) combos = combos.flatMap((c) => axis.map((v) => [...c, v]));
      for (const combo of combos) contexts.add(`${base} (${combo.join(", ")})`);
    }
  }
  return contexts;
}

const argv = process.argv.slice(2);
const requiredFlag = argv.indexOf("--required");
if (requiredFlag !== -1) {
  const supplied = argv.slice(requiredFlag + 1).filter(Boolean);
  const produced = producedContexts(WORKFLOWS);
  const missing = supplied.filter((c) => !produced.has(c));
  if (missing.length) {
    console.error(`${missing.length} required check(s) no workflow produces\n`);
    for (const c of missing) console.error(`  ${c}`);
    process.exit(1);
  }
  console.log(`all ${supplied.length} required check(s) are produced`);
  process.exit(0);
}

const repos = argv;
if (repos.length === 0) {
  repos.push(gh(["repo", "view", "--json", "nameWithOwner", "-q", ".nameWithOwner"]).trim());
}

let failed = false;
for (const repo of repos) {
  let required;
  try {
    required = JSON.parse(
      gh(["api", `repos/${repo}/branches/main/protection/required_status_checks`]),
    ).contexts;
  } catch {
    console.error(`${repo}: cannot read branch protection — an admin token is needed`);
    failed = true;
    continue;
  }
  // Only this repository's workflows are on disk. For another repo the comparison would
  // be against the wrong files, so say that rather than pass on a set nobody checked.
  const produced = repos.length === 1 ? producedContexts(WORKFLOWS) : null;
  if (produced === null) {
    console.log(`${repo}: required = ${required.join(", ")}`);
    continue;
  }
  const missing = required.filter((c) => !produced.has(c));
  if (missing.length) {
    failed = true;
    console.error(`${repo}: ${missing.length} required check(s) no workflow produces\n`);
    for (const c of missing) console.error(`  ${c}`);
    console.error(
      "\nAn absent check is not a failure. GitHub waits for it, so every pull request" +
        "\nstays BLOCKED with nothing to look at, and the only way past is --admin.",
    );
  } else {
    console.log(`${repo}: all ${required.length} required check(s) are produced — ${required.join(", ")}`);
  }
}

process.exit(failed ? 1 : 0);
