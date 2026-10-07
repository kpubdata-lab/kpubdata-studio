/**
 * Refuse workflow steps that run another repository's code by a movable ref (#729).
 *
 * A `uses:` reference to another repository runs whatever that ref points at when the
 * job starts. A branch (`@main`) or a tag (`@v7`) can move without a change in this
 * repository, so the release, title and review gates — and the steps that push tags and
 * create releases — would run code nobody here reviewed. Every such reference must name
 * a full 40-character commit SHA. Builder has the same gate (kpubdata-builder#1003).
 *
 * What is swept: every `*.yml`/`*.yaml` under `.github/workflows` and `.github/actions`.
 * A local reference (`./.github/workflows/x.yml`) runs this repository's own code at the
 * same commit and passes. A `docker://` image must be pinned by `@sha256:` digest.
 *
 * Keeping the pins current:
 *
 * - Third-party actions carry a `# vX.Y.Z` comment; Dependabot (`github-actions`) raises
 *   the SHA and the comment together.
 * - The shared kpubdata actions have no release tags of their own and are ignored by
 *   Dependabot. Move them together, to one kpubdata commit, with `--bump-kpubdata`:
 *
 *       node scripts/check-action-pins.mjs --bump-kpubdata \
 *         "$(gh api repos/kpubdata-lab/kpubdata/commits/main --jq .sha)"
 *
 * Usage:
 *   node scripts/check-action-pins.mjs                    # exit 1 on any finding
 *   node scripts/check-action-pins.mjs FILE...            # check only these files
 *   node scripts/check-action-pins.mjs --bump-kpubdata SHA
 */
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const SWEPT_DIRS = [".github/workflows", ".github/actions"];

/** The repository whose shared actions `--bump-kpubdata` moves. */
export const KPUBDATA_REPO = "kpubdata-lab/kpubdata";

const USES = /^(?<head>\s*(?:-\s+)?uses:\s*)(?<quote>["']?)(?<ref>[^\s"'#]+)\k<quote>(?<tail>.*)$/;
const SHA = /^[0-9a-f]{40}$/;
const DIGEST = /^sha256:[0-9a-f]{64}$/;

/** Why `ref` is not pinned, or `null` when it is. */
export function reason(ref) {
  if (ref.startsWith("./")) return null;
  if (ref.startsWith("docker://")) {
    const at = ref.indexOf("@");
    if (at !== -1 && DIGEST.test(ref.slice(at + 1))) return null;
    return "pin the image by @sha256: digest";
  }
  const at = ref.lastIndexOf("@");
  if (at === -1) return "no ref; pin a full commit SHA";
  const version = ref.slice(at + 1);
  if (SHA.test(version)) return null;
  return `'${version}' can move; pin a full 40-character commit SHA`;
}

/** Every movable reference in `paths`, as `{ path, line, ref, reason }`. */
export function check(paths) {
  const violations = [];
  for (const path of paths) {
    readFileSync(path, "utf8")
      .split(/\r?\n/)
      .forEach((text, index) => {
        const match = USES.exec(text);
        if (!match) return;
        const why = reason(match.groups.ref);
        if (why !== null) violations.push({ path, line: index + 1, ref: match.groups.ref, reason: why });
      });
  }
  return violations;
}

/** Point every shared kpubdata action at `sha`; return the files changed. */
export function bumpKpubdata(paths, sha) {
  if (!SHA.test(sha)) throw new Error(`not a full 40-character commit SHA: ${JSON.stringify(sha)}`);
  const prefix = `${KPUBDATA_REPO}/`;
  const changed = [];
  for (const path of paths) {
    const text = readFileSync(path, "utf8");
    const updated = text
      .split("\n")
      .map((line) => {
        const eol = line.endsWith("\r") ? "\r" : "";
        const match = USES.exec(line.slice(0, line.length - eol.length));
        if (!match || !match.groups.ref.startsWith(prefix)) return line;
        const { head, quote, ref } = match.groups;
        const action = ref.slice(0, ref.lastIndexOf("@"));
        return `${head}${quote}${action}@${sha}${quote}  # ${KPUBDATA_REPO} main${eol}`;
      })
      .join("\n");
    if (updated !== text) {
      writeFileSync(path, updated);
      changed.push(path);
    }
  }
  return changed;
}

function walk(dir) {
  return readdirSync(dir)
    .sort()
    .flatMap((name) => {
      const path = join(dir, name);
      return statSync(path).isDirectory() ? walk(path) : [path];
    });
}

export function defaultPaths(root = ROOT) {
  return SWEPT_DIRS.map((dir) => join(root, dir))
    .filter((dir) => existsSync(dir))
    .flatMap(walk)
    .filter((path) => /\.ya?ml$/.test(path));
}

export function main(argv) {
  const files = [];
  let bump = null;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--bump-kpubdata") {
      bump = argv[i + 1] ?? "";
      i += 1;
    } else {
      files.push(argv[i]);
    }
  }
  const paths = files.length > 0 ? files : defaultPaths();

  if (bump !== null) {
    try {
      for (const path of bumpKpubdata(paths, bump)) console.log(`updated ${path}`);
    } catch (error) {
      console.error(`error: ${error.message}`);
      return 2;
    }
  }

  const violations = check(paths);
  for (const v of violations) console.error(`${v.path}:${v.line}: ${v.ref} — ${v.reason}`);
  if (violations.length > 0) {
    console.error(
      `\n${violations.length} reference(s) can change without a change here. ` +
        "Pin each to a full commit SHA (see scripts/check-action-pins.mjs).",
    );
    return 1;
  }
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
