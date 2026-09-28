/**
 * Pure model helper for Builds/Runs master-detail (#255).
 *
 * Use only values returned by Builder; Studio doesn't guess or recalculate state (#246 principle).
 * Run overall status (BuildRunStatus) and medallion stage status (StageStatus, #488) are
 * different axes; never collapse into one here either.
 */
import { ApiError } from "@/shared/lib/builderApi";
import type { BuildListItem, BuildRunStatus } from "@/shared/lib/types";
import type { BuildEvent, BuildQualityResponse, QualityCheckResult, RunStageEntry } from "@/shared/lib/builderApi";

/**
 * Aggregation for top KPI card.
 *
 * Builder `GET /builds` doesn't provide total count, only truncated list by `limit`
 * (no count field in BuildsResponse; contract SSOT verified). So this aggregation
 * computes only within current query scope, not real total history — caller must
 * expose both `scopeLimit`/`scopeCount` to reveal that fact.
 *
 * Also `GET /builds` returns only completed (ok/failed) history, doesn't include
 * in-flight (queued/running) jobs (separate in-memory registry, `GET /builds/{run_id}`).
 * So in live mode, can't count "currently running Runs" from this list alone —
 * if `runningAvailable` is false, show N/A in UI, don't pretend running=0.
 */
export interface BuildKpi {
  scopeCount: number;
  scopeLimit: number;
  succeeded: number;
  failed: number;
  cancelled: number;
  /** running + queued + cancelling sum (preserve backward compat for existing Running KPI). */
  running: number;
  /** Count where status is exactly "running". */
  runningOnly: number;
  /** Count where status is exactly "queued". */
  queuedOnly: number;
  /** Count where status is exactly "cancelling". */
  cancellingOnly: number;
  /** False if running value unreliable in this scope (contract: only completed history). */
  runningAvailable: boolean;
}

export function computeBuildKpi(
  items: BuildListItem[],
  scopeLimit: number,
  runningAvailable: boolean,
): BuildKpi {
  let succeeded = 0;
  let failed = 0;
  let cancelled = 0;
  let runningOnly = 0;
  let queuedOnly = 0;
  let cancellingOnly = 0;
  for (const item of items) {
    if (item.status === "succeeded") succeeded += 1;
    else if (item.status === "failed") failed += 1;
    else if (item.status === "cancelled") cancelled += 1;
    else if (item.status === "running") runningOnly += 1;
    else if (item.status === "queued") queuedOnly += 1;
    else if (item.status === "cancelling") cancellingOnly += 1;
  }
  // Running KPI still uses running+queued+cancelling sum as value (preserve policy) — but
  // expose each of three separately so caller can show breakdown (running/queued/cancelling).
  // Count actual status only in current scope; don't guess.
  const running = runningOnly + queuedOnly + cancellingOnly;
  return {
    scopeCount: items.length,
    scopeLimit,
    succeeded,
    failed,
    cancelled,
    running,
    runningOnly,
    queuedOnly,
    cancellingOnly,
    runningAvailable,
  };
}

export type RunStatusFilter = "all" | BuildRunStatus;

export function matchesStatusFilter(item: BuildListItem, filter: RunStatusFilter): boolean {
  return filter === "all" || item.status === filter;
}

export function matchesSearch(item: BuildListItem, query: string): boolean {
  const trimmed = query.trim().toLowerCase();
  if (!trimmed) return true;
  const haystack = `${item.title ?? ""} ${item.id}`.toLowerCase();
  return haystack.includes(trimmed);
}

/** If multiple sources and any failed, return list of failed sources (#255 §7). */
export function failedSources(sources: RunStageEntry[]): string[] {
  return sources
    .filter((source) => source.bronze.status === "failed" || source.silver.status === "failed" || source.gold.status === "failed")
    .map((source) => source.source_key);
}

/** Last completed medallion stage for source; null if none (no guessing). */
export function lastCompletedStage(source: RunStageEntry): "gold" | "silver" | "bronze" | null {
  if (source.gold.status === "completed") return "gold";
  if (source.silver.status === "completed") return "silver";
  if (source.bronze.status === "completed") return "bronze";
  return null;
}

/** First medallion stage recorded as failed for source; not_run is not failure. */
export function firstFailedStage(source: RunStageEntry): "bronze" | "silver" | "gold" | null {
  if (source.bronze.status === "failed") return "bronze";
  if (source.silver.status === "failed") return "silver";
  if (source.gold.status === "failed") return "gold";
  return null;
}

/**
 * Distinguish clearly when multiple sources: "all succeeded" / "partial" / "all failed" /
 * "unavailable" only. Builder run status enum lacks "partial" (BuildJob: queued/running/
 * cancelling/succeeded/failed/cancelled), so this is separate UI-only summary for source
 * combination, doesn't replace Run status.
 */
export type MultiSourceOutcome = "all_succeeded" | "partial" | "all_failed" | "unavailable";

export function summarizeMultiSourceOutcome(sources: RunStageEntry[]): MultiSourceOutcome {
  if (sources.length === 0) return "unavailable";
  const failedCount = failedSources(sources).length;
  if (failedCount === 0) return "all_succeeded";
  if (failedCount === sources.length) return "all_failed";
  return "partial";
}

export interface FailureEvidenceItem {
  sourceKey: string;
  failedStage: "bronze" | "silver" | "gold" | null;
  lastCompletedStage: "gold" | "silver" | "bronze" | null;
}

export function collectFailureEvidence(sources: RunStageEntry[]): FailureEvidenceItem[] {
  return sources
    .filter((source) => firstFailedStage(source) !== null)
    .map((source) => ({
      sourceKey: source.source_key,
      failedStage: firstFailedStage(source),
      lastCompletedStage: lastCompletedStage(source),
    }));
}

/**
 * Classify errors from APIs constructing selected Run detail (stage/quality/spec/live status)
 * into minimal kinds Studio can draw (#255 P0 permission state).
 *
 * Don't guess "permission denied" — classify as permission_denied only when Builder says HTTP 403
 * explicitly; treat all other 401/network/5xx as generic error. Create no new auth model;
 * read existing ApiError.status only.
 */
export type RunApiErrorKind = "not_found" | "permission_denied" | "error";

export function classifyRunApiError(cause: unknown): RunApiErrorKind {
  if (cause instanceof ApiError) {
    if (cause.status === 404) return "not_found";
    if (cause.status === 403) return "permission_denied";
  }
  return "error";
}

export function failQualityResults(quality: BuildQualityResponse | null | undefined): QualityCheckResult[] {
  if (!quality) return [];
  return Object.values(quality.quality_results).flat().filter((result) => result.status === "fail");
}

/**
 * P1 Structured Run Events (#496 evidence, #255 §1) pure helper.
 *
 * `GET /builds/{run_id}/events` always responds in chronological ascending (builder contract).
 * This file summarizes evidence as-is, doesn't create new judgment replacing Stage (#488)/
 * Quality (#486) canonical sources.
 */

/** Reserved key used to group events that lack source_key (global run scope). Avoids collision with real source_key. */
export const GLOBAL_RUN_EVENT_SOURCE_KEY = "__run__";

/** Select only events recorded with status "fail" (keep original order). */
export function failedRunEvents(events: BuildEvent[]): BuildEvent[] {
  return events.filter((event) => event.status === "fail");
}

/** Given chronological ascending events, return the last event with status "ok"; null if none (don't guess). */
export function lastOkRunEvent(events: BuildEvent[]): BuildEvent | null {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    if (events[index].status === "ok") return events[index];
  }
  return null;
}

/**
 * Group events by source_key. Helper to avoid collapsing multi-source events into the first source (#255 §1).
 * Events without source_key (global run) are grouped under GLOBAL_RUN_EVENT_SOURCE_KEY and not merged with real source events.
 * Preserve the original ascending order inside each group.
 */
export function groupRunEventsBySource(events: BuildEvent[]): Map<string, BuildEvent[]> {
  const grouped = new Map<string, BuildEvent[]>();
  for (const event of events) {
    const key = event.source_key ?? GLOBAL_RUN_EVENT_SOURCE_KEY;
    const bucket = grouped.get(key);
    if (bucket) bucket.push(event);
    else grouped.set(key, [event]);
  }
  return grouped;
}

/** Render a single metrics value as a short human-readable string. */
function formatEventMetricValue(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

/**
 * Make a one-line compact summary of event.metrics. Return null if no metrics.
 * Truncate overly long values; the original event.metrics remain in the evidence.
 */
export function summarizeEventMetrics(metrics: BuildEvent["metrics"]): string | null {
  if (!metrics) return null;
  const entries = Object.entries(metrics);
  if (entries.length === 0) return null;
  const summary = entries.map(([key, value]) => `${key}=${formatEventMetricValue(value)}`).join(", ");
  return summary.length > 160 ? `${summary.slice(0, 157)}...` : summary;
}
