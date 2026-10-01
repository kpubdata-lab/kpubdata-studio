/**
 * Which algorithm made a run's Gold ratio splits (#671, builder#871, contract 1.70.0).
 *
 * Builder records `split_algorithm` in the manifest: `hash-sort-v2` today. The field is
 * there only when the BuildSpec declares a ratio split, and a manifest written before
 * 1.70.0 lacks it — Builder reads such a manifest's ratio splits as `shuffle-v1`. The two
 * put different rows in train/test for the same seed, which is why a rebuild of the same
 * BuildSpec can split differently.
 *
 * So an absent field means `shuffle-v1` only when the run's BuildSpec declares a ratio
 * split. Without the BuildSpec Studio cannot tell "older manifest" from "no ratio split",
 * and says it cannot tell rather than picking one. A value Studio does not know is shown
 * as sent.
 */
import { parse as parseYaml } from "yaml";

/** The algorithms the contract names. Anything else is still shown, as sent. */
export const KNOWN_SPLIT_ALGORITHMS = ["shuffle-v1", "hash-sort-v2"] as const;

/** What Builder reads an absent field as, for a run whose BuildSpec declares a ratio split. */
export const LEGACY_SPLIT_ALGORITHM = "shuffle-v1";

/** What the run's BuildSpec declares under `splits`; `unknown` when it could not be read. */
export type SplitMode = "ratio" | "key" | "none" | "unknown";

export type RunSplitAlgorithm =
  /** The manifest names it. */
  | { kind: "recorded"; algorithm: string; known: boolean }
  /** Not recorded, and the BuildSpec declares a ratio split: Builder's `shuffle-v1`. */
  | { kind: "legacy"; algorithm: typeof LEGACY_SPLIT_ALGORITHM }
  /** A key split: no algorithm decides its membership. */
  | { kind: "key" }
  /** No split declared. */
  | { kind: "none" }
  /** Not recorded, and the BuildSpec (or the manifest) could not be read. */
  | { kind: "unknown" };

export function splitModeOf(specYaml: string): SplitMode {
  let parsed: unknown;
  try {
    parsed = parseYaml(specYaml);
  } catch {
    return "unknown";
  }
  if (!parsed || typeof parsed !== "object") return "unknown";
  const splits = (parsed as Record<string, unknown>).splits;
  if (splits === undefined || splits === null) return "none";
  if (typeof splits !== "object") return "unknown";
  const mode = (splits as Record<string, unknown>).mode;
  return mode === "ratio" || mode === "key" ? mode : "unknown";
}

/**
 * @param manifestAlgorithm - the manifest's `split_algorithm`; `undefined` when the manifest
 *   was read without it, `null` when the manifest could not be read.
 * @param mode - what the run's BuildSpec declares.
 */
export function resolveSplitAlgorithm(manifestAlgorithm: string | undefined | null, mode: SplitMode): RunSplitAlgorithm {
  if (typeof manifestAlgorithm === "string") {
    return {
      kind: "recorded",
      algorithm: manifestAlgorithm,
      known: (KNOWN_SPLIT_ALGORITHMS as readonly string[]).includes(manifestAlgorithm),
    };
  }
  if (mode === "none") return { kind: "none" };
  if (mode === "key") return { kind: "key" };
  // Only a manifest read without the field is an older one; an unread manifest says nothing.
  if (mode === "ratio" && manifestAlgorithm === undefined) return { kind: "legacy", algorithm: LEGACY_SPLIT_ALGORITHM };
  return { kind: "unknown" };
}

/** The algorithm's name, when there is one to compare. */
export function algorithmName(split: RunSplitAlgorithm): string | null {
  return split.kind === "recorded" || split.kind === "legacy" ? split.algorithm : null;
}

/** Two runs' ratio splits came from different algorithms — only when both are named. */
export function splitAlgorithmsDiffer(a: RunSplitAlgorithm, b: RunSplitAlgorithm): boolean {
  const left = algorithmName(a);
  const right = algorithmName(b);
  return left !== null && right !== null && left !== right;
}
