/**
 * Studio's version must follow Builder's (kpubdata ADR 0004, kpubdata#895).
 *
 * Builder and Studio ship as one application at one version. `release.yml`'s prepare
 * job reads Builder's newest release tag (`gh release view`) and writes exactly that
 * into package.json, so Studio never chooses a number. This holds the result:
 *
 *   default         the CI gate. Fails when package.json is ahead of Builder's newest
 *                   release, or when a release pull request (`release/*`) names any
 *                   other version. Behind is allowed outside a release pull request:
 *                   Builder releases first, and Studio follows a day later.
 *   --require-tag   the release job. Fails unless Builder has the tag `v<package.json
 *                   version>`, so Studio never releases a version Builder has not.
 *
 * The comparison is pure (`compareWithBuilder`, `requireBuilderTag`); only `main` reaches
 * GitHub, through `gh`, and its lookups can be replaced so the tests need no network.
 *
 * Usage:
 *   node scripts/check-builder-version.mjs [--head-ref REF] [--builder-tag TAG]
 *   node scripts/check-builder-version.mjs --require-tag
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const BUILDER_REPO = "kpubdata-lab/kpubdata-builder";

const VERSION = /^v?(\d+)\.(\d+)\.(\d+)$/;

/** `[major, minor, patch]` of `0.4.0` or `v0.4.0`, or `null` for anything else. */
export function parseVersion(text) {
  const match = VERSION.exec((text ?? "").trim());
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
}

function order(a, b) {
  for (let i = 0; i < 3; i += 1) {
    if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
  }
  return 0;
}

/** Whether `headRef` is a release pull request's branch, as the prepare job names it. */
export function isReleaseBranch(headRef) {
  return typeof headRef === "string" && headRef.startsWith("release/");
}

/**
 * Studio's `studioVersion` against Builder's newest release tag.
 * Returns `{ ok, message }`; `warning` is set when it passes while behind.
 */
export function compareWithBuilder({ studioVersion, builderTag, headRef = "" }) {
  const studio = parseVersion(studioVersion);
  if (studio === null) {
    return { ok: false, message: `package.json version ${JSON.stringify(studioVersion)} is not X.Y.Z` };
  }
  if (!builderTag) {
    return { ok: false, message: `${BUILDER_REPO} has no release to follow` };
  }
  const builder = parseVersion(builderTag);
  if (builder === null) {
    return { ok: false, message: `${BUILDER_REPO}'s newest release tag ${JSON.stringify(builderTag)} is not vX.Y.Z` };
  }
  const studioTag = `v${studio.join(".")}`;
  const cmp = order(studio, builder);
  if (cmp > 0) {
    return {
      ok: false,
      message:
        `package.json is ${studioTag}, ahead of ${BUILDER_REPO}'s newest release ${builderTag}. ` +
        "Studio does not choose its version (ADR 0004): release.yml mode=prepare writes Builder's.",
    };
  }
  if (isReleaseBranch(headRef) && cmp !== 0) {
    return {
      ok: false,
      message: `release pull request ${headRef} declares ${studioTag}, but ${BUILDER_REPO}'s newest release is ${builderTag}`,
    };
  }
  if (cmp < 0) {
    return {
      ok: true,
      warning: true,
      message: `package.json is ${studioTag}, behind ${BUILDER_REPO}'s ${builderTag}; release.yml mode=prepare follows it`,
    };
  }
  return { ok: true, message: `package.json ${studioTag} matches ${BUILDER_REPO}'s newest release` };
}

/** The release job's check: Builder must have the tag Studio is about to release. */
export function requireBuilderTag({ studioVersion, tagExists }) {
  const studio = parseVersion(studioVersion);
  if (studio === null) {
    return { ok: false, message: `package.json version ${JSON.stringify(studioVersion)} is not X.Y.Z` };
  }
  const tag = `v${studio.join(".")}`;
  if (!tagExists) {
    return {
      ok: false,
      message: `${BUILDER_REPO} has no tag ${tag}. Release Builder ${tag} first; Studio follows its version (ADR 0004).`,
    };
  }
  return { ok: true, message: `${BUILDER_REPO} has ${tag}` };
}

function gh(args) {
  return execFileSync("gh", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

/** The real lookups, over the GitHub API. Replaced in tests. */
export const github = {
  latestTag() {
    return gh(["release", "view", "--repo", BUILDER_REPO, "--json", "tagName", "-q", ".tagName"]);
  },
  hasTag(tag) {
    try {
      gh(["api", `repos/${BUILDER_REPO}/git/ref/tags/${tag}`, "--jq", ".ref"]);
      return true;
    } catch (error) {
      if (/HTTP 404/.test(String(error?.stderr ?? error?.message ?? ""))) return false;
      throw error;
    }
  },
};

export function readStudioVersion(root = ROOT) {
  return JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version;
}

function report(result) {
  if (!result.ok) console.error(`::error::${result.message}`);
  else if (result.warning) console.log(`::warning::${result.message}`);
  else console.log(result.message);
  return result.ok ? 0 : 1;
}

export function main(argv, { lookup = github, studioVersion = readStudioVersion() } = {}) {
  let headRef = process.env.HEAD_REF ?? "";
  let builderTag = null;
  let requireTag = false;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--head-ref") {
      headRef = argv[i + 1] ?? "";
      i += 1;
    } else if (argv[i] === "--builder-tag") {
      builderTag = argv[i + 1] ?? "";
      i += 1;
    } else if (argv[i] === "--require-tag") {
      requireTag = true;
    } else {
      console.error(`error: unknown argument ${argv[i]}`);
      return 2;
    }
  }

  try {
    if (requireTag) {
      const parsed = parseVersion(studioVersion);
      const tagExists = parsed !== null && lookup.hasTag(`v${parsed.join(".")}`);
      return report(requireBuilderTag({ studioVersion, tagExists }));
    }
    if (builderTag === null) builderTag = lookup.latestTag();
  } catch (error) {
    console.error(`::error::could not read ${BUILDER_REPO}'s releases: ${String(error?.stderr || error?.message || error).trim()}`);
    return 1;
  }
  return report(compareWithBuilder({ studioVersion, builderTag, headRef }));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
