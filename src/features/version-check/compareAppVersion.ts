/**
 * Compare Studio's own release with the Builder it is talking to (#430).
 *
 * Builder and Studio ship as one application under one version (kpubdata ADR 0004),
 * so "is this the matching Builder" is a comparison, not a compatibility table. This
 * is a pairing check only — the HTTP contract (`api_version`) is judged separately by
 * `isBuilderApiCompatible` and says what Studio may expect, not whether the two came
 * from the same release (ADR 0004 §3).
 */

/**
 * - `match` — same release.
 * - `patch` — only the patch differs; pass silently.
 * - `mismatch` — major or minor differs; tell the user.
 * - `unknown` — one side did not say, or said something unparseable. Not knowing is
 *   not the same as differing, so this never warns.
 */
export type AppVersionComparison =
  | { kind: "match" }
  | { kind: "patch"; studio: string; builder: string }
  | { kind: "mismatch"; studio: string; builder: string }
  | { kind: "unknown" };

/** `0.4.1`, `v0.4.1`, `0.4.1.dev0`, `0.4.1-rc.1` → `[0, 4, 1]`. */
function releaseOf(version: string): [number, number, number] | null {
  const match = /^v?(\d+)\.(\d+)\.(\d+)/.exec(version.trim());
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

/**
 * @param studio - Studio's build version, injected from `package.json`.
 * @param builder - `version` from `GET /version`; absent on Builders that predate it.
 */
export function compareAppVersion(
  studio: string | undefined | null,
  builder: string | undefined | null,
): AppVersionComparison {
  if (!studio || !builder) return { kind: "unknown" };
  const s = releaseOf(studio);
  const b = releaseOf(builder);
  if (!s || !b) return { kind: "unknown" };
  if (s[0] !== b[0] || s[1] !== b[1]) return { kind: "mismatch", studio, builder };
  if (s[2] !== b[2]) return { kind: "patch", studio, builder };
  return { kind: "match" };
}
