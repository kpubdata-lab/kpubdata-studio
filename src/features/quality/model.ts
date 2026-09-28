import type { BuildQualityResponse, PreviewSource, QualityCheckResult, SchemaDriftFinding } from "@/shared/lib/builderApi";
import { i18n } from "@/shared/i18n";

export type ValidationStatus = "PASS" | "WARN" | "FAIL" | "N/A";

/** Aggregate Builder quality results without scores, only as PASS/WARN/FAIL/N/A. */
export function summarizeQuality(
  quality: BuildQualityResponse | null | undefined,
  sourceKey?: string,
): ValidationStatus {
  if (!quality) return "N/A";
  const groups = sourceKey
    ? [quality.quality_results[sourceKey] ?? []]
    : Object.values(quality.quality_results);
  const results = groups.flat();
  if (results.length === 0) return "N/A";
  if (results.some((result) => result.status === "fail")) return "FAIL";
  if (results.some((result) => result.status === "warn")) return "WARN";
  return "PASS";
}

/** Return actual quality results for selected source only. */
export function qualityResultsForSource(
  quality: BuildQualityResponse | null | undefined,
  sourceKey: string,
): QualityCheckResult[] {
  return quality?.quality_results[sourceKey] ?? [];
}

/**
 * Extension for Quality Center (#254).
 *
 * Above two functions (#253) are used for single-source scope display in dataset
 * detail; Quality Center needs separate function to aggregate across sources,
 * distinguish availability, and show evaluated_checks=0 (N/A).
 */

/** Representative status expressing both full run (with availability) and individual
 * result aggregation. Preserves Builder #486 semantics: distinguishes
 * NOT_EVALUATED (no evaluated checks) from UNAVAILABLE (availability=unavailable)
 * without collapsing to PASS/N/A. */
export type QualityState = "FAIL" | "WARN" | "PASS" | "NOT_EVALUATED" | "UNAVAILABLE";

const PERCENTAGE_QUALITY_RULES = new Set(["max_null_ratio", "max_duplicate_rate"]);
const ROW_COUNT_QUALITY_RULES = new Set(["min_rows"]);

/**
 * Add units only for Builder canonical rules. Structured thresholds and unknown
 * rules preserve original JSON representation without inferring meaning.
 */
export function formatQualityValue(rule: string, value: unknown): string {
  if (value === null || value === undefined) return "N/A";
  if (typeof value === "number") {
    if (PERCENTAGE_QUALITY_RULES.has(rule) && value >= 0 && value <= 1) {
      return `${(value * 100).toFixed(1)}%`;
    }
    const formatted = value.toLocaleString(
      i18n.language?.startsWith("en") ? "en-US" : "ko-KR",
    );
    return ROW_COUNT_QUALITY_RULES.has(rule)
      ? i18n.t("quality.model.rows", { count: formatted })
      : formatted;
  }
  return typeof value === "string" ? value : JSON.stringify(value);
}

function worstResultStatus(results: QualityCheckResult[]): "fail" | "warn" | "pass" | null {
  if (results.some((result) => result.status === "fail")) return "fail";
  if (results.some((result) => result.status === "warn")) return "warn";
  if (results.length > 0) return "pass";
  return null;
}

/** Flatten quality_results (optionally scoped by source_key) into single array. */
export function flattenQualityResults(
  quality: BuildQualityResponse | null | undefined,
  sourceKey?: string,
): QualityCheckResult[] {
  if (!quality) return [];
  const groups = sourceKey ? [quality.quality_results[sourceKey] ?? []] : Object.values(quality.quality_results);
  return groups.flat();
}

/** Flatten schema_drift (optionally scoped by source_key) into single array. */
export function flattenSchemaDrift(
  quality: BuildQualityResponse | null | undefined,
  sourceKey?: string,
): SchemaDriftFinding[] {
  if (!quality) return [];
  const groups = sourceKey ? [quality.schema_drift[sourceKey] ?? []] : Object.values(quality.schema_drift);
  return groups.flat();
}

/**
 * Determine representative severity of evaluation results first
 * (FAIL > WARN > PASS > NOT_EVALUATED). Availability is separate axis; use
 * UNAVAILABLE only when quality response itself is missing.
 */
export function overallQualityState(
  quality: BuildQualityResponse | null | undefined,
  sourceKey?: string,
): QualityState {
  if (!quality) return "UNAVAILABLE";
  const worst = worstResultStatus(flattenQualityResults(quality, sourceKey));
  if (worst === "fail") return "FAIL";
  if (worst === "warn") return "WARN";
  if (worst === "pass") return "PASS";
  return "NOT_EVALUATED";
}

export interface ChecksPassedSummary {
  pass: number;
  warn: number;
  fail: number;
  /** Denominator. Always actual evaluated check count; 0 means status is N/A
   * (not shown as fake PASS/0%). */
  evaluated: number;
  status: ValidationStatus;
}

/** Summary in PASS/evaluated form. If evaluated===0, status is N/A. */
export function summarizeChecksPassed(results: QualityCheckResult[]): ChecksPassedSummary {
  const pass = results.filter((result) => result.status === "pass").length;
  const warn = results.filter((result) => result.status === "warn").length;
  const fail = results.filter((result) => result.status === "fail").length;
  const evaluated = results.length;
  const worst = worstResultStatus(results);
  const status: ValidationStatus = worst === "fail" ? "FAIL" : worst === "warn" ? "WARN" : worst === "pass" ? "PASS" : "N/A";
  return { pass, warn, fail, evaluated, status };
}

/**
 * Pick question for Quality Center header's "Explain this issue" button, tailored to
 * current Quality state.
 *
 * Previously, fixed "cause/remedy of WARN/FAIL" seed regardless of state, sending
 * nonsensical questions for Runs where all checks pass (confirmed in real Builder
 * E2E). Per-issue "Explain this issue" button already has issue context, so this
 * function is for header button only.
 */
export function qualityKubiSeedQuestion(summary: ChecksPassedSummary): string {
  if (summary.evaluated === 0) {
    return i18n.t("quality.model.seed.none");
  }
  if (summary.warn > 0 || summary.fail > 0) {
    return i18n.t("quality.model.seed.issues");
  }
  return i18n.t("quality.model.seed.allPass");
}

export interface CategorySummary extends ChecksPassedSummary {
  /** Most severe individual result for display (FAIL > WARN > first PASS). null
   * if no evaluated results. */
  worst: QualityCheckResult | null;
}

/** Pick and summarize results matching category matcher. Builder category is free
 * string, so don't assume exact value list. */
export function summarizeByCategory(
  results: QualityCheckResult[],
  matches: (category: string) => boolean,
): CategorySummary {
  const filtered = results.filter((result) => matches(result.category));
  const base = summarizeChecksPassed(filtered);
  const worst =
    filtered.find((result) => result.status === "fail") ??
    filtered.find((result) => result.status === "warn") ??
    filtered[0] ??
    null;
  return { ...base, worst };
}

export const isMissingCategory = (category: string): boolean => /missing|null/i.test(category);
export const isDuplicateCategory = (category: string): boolean => /duplicate/i.test(category);
export const isSchemaCategory = (category: string): boolean => /schema/i.test(category);
/** category === "range" (Builder rule list: min_rows/range/compare_columns, etc., #497). */
export const isRangeCategory = (category: string): boolean => /range/i.test(category);
/**
 * rule === "dtype" (Add Data Preview & Validation's "Type" bucket, #250). Builder
 * has no separate "type" category; it's dtype rule within schema category, so match
 * by rule name, not category.
 */
export const isTypeRule = (rule: string): boolean => rule === "dtype";

/** Group results by actual category value while preserving first-appearance order
 * (no fixed list assumed). */
export function groupByCategory(results: QualityCheckResult[]): { category: string; results: QualityCheckResult[] }[] {
  const order: string[] = [];
  const groups = new Map<string, QualityCheckResult[]>();
  for (const result of results) {
    if (!groups.has(result.category)) {
      groups.set(result.category, []);
      order.push(result.category);
    }
    groups.get(result.category)!.push(result);
  }
  return order.map((category) => ({ category, results: groups.get(category)! }));
}

/** Keep only WARN/FAIL results for "Recent quality issues". */
export function warnOrFailResults(results: QualityCheckResult[]): QualityCheckResult[] {
  return results.filter((result) => result.status !== "pass");
}

/**
 * When PreviewResponse.previews[] returns multiple sources (#250 §3), show each
 * source state separately; Studio doesn't collapse to single PASS/FAIL.
 *
 * Classifies only values from Builder — no status is invented.
 *   - "failed": source.status === "failed" (fetch/query failed)
 *   - "zero_rows": normal response but total_rows === 0 (different from fetch fail)
 *   - "not_evaluated": normal response with rows but quality_results empty (N/A)
 *   - "ok": normal evaluation result not in above three
 */
export type PreviewSourceState = "ok" | "failed" | "zero_rows" | "not_evaluated";

export function previewSourceState(source: PreviewSource): PreviewSourceState {
  if (source.status === "failed") return "failed";
  if (source.total_rows === 0) return "zero_rows";
  if (source.quality_results.length === 0) return "not_evaluated";
  return "ok";
}

export interface PreviewSourceSummary {
  source: PreviewSource;
  state: PreviewSourceState;
  quality: ChecksPassedSummary;
}

export interface PreviewSourcesSummary {
  /** True only when sources >= 2 and states differ (#250 §3, "mixed"). */
  mixed: boolean;
  perSource: PreviewSourceSummary[];
}

/**
 * Calculate per-source state/quality summary and whether overall is "mixed"
 * (some succeed + some fail/not evaluated). Multiple source quality_results
 * are not merged to single PASS — just list results as-is per source.
 */
export function summarizePreviewSources(previews: readonly PreviewSource[]): PreviewSourcesSummary {
  const perSource = previews.map((source) => ({
    source,
    state: previewSourceState(source),
    quality: summarizeChecksPassed(source.quality_results),
  }));
  const states = new Set(perSource.map((p) => p.state));
  return { mixed: previews.length > 1 && states.size > 1, perSource };
}

// NOTE(#350): This constant is used by screens that PR #360 is modifying, so keep
// as-is — changing to function will conflict with that PR. Labels are already
// moved to `quality.model.previewState.*`; after #360 merges, migrate all uses
// together.
/**
 * Resolve preview source state label **at call time**.
 *
 * Top-level module constant locks labels at import time, leaving this tab in old
 * language even after language change (#350). Keep only keys, translate at every
 * render.
 */
const _PREVIEW_SOURCE_STATE_KEY: Record<PreviewSourceState, string> = {
  ok: "quality.previewSourceState.ok",
  failed: "quality.previewSourceState.failed",
  zero_rows: "quality.previewSourceState.zeroRows",
  not_evaluated: "quality.previewSourceState.notEvaluated",
};

export function previewSourceStateLabel(state: PreviewSourceState): string {
  return i18n.t(_PREVIEW_SOURCE_STATE_KEY[state]);
}
