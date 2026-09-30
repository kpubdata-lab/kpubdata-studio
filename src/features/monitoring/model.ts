/**
 * Shared Monitoring-domain models (#264, #303).
 *
 * State vocabulary and pure helpers shared by the page and its panels.
 * The wire-schema types' canon is `@/shared/lib/builderApi.schema`.
 */
import type {
  MonitoringRecentRun,
  MonitoringSummaryResponse,
  MonitoringBuildsResponse,
} from "@/shared/lib/builderApi.schema";

export type MonitoringLoadingState = "idle" | "loading" | "success" | "error";

/** Screen model bundling the parallel /monitoring/summary + /monitoring/builds lookups (#302). */
export interface MonitoringData {
  summary: MonitoringSummaryResponse;
  builds: MonitoringBuildsResponse;
}

/**
 * Maps a BuildIndex run status to the shared run-status vocabulary of `StatusBadge`.
 * BuildIndex says `ok` for a succeeded run; anything else passes through unchanged, so a
 * status this Studio does not know is still shown as Builder sent it.
 */
export function runStatusValue(status: string): string {
  return status === "ok" ? "succeeded" : status;
}

/** Computes elapsed seconds from started/finished timestamps — builder sends no duration. */
export function runDurationSeconds(run: MonitoringRecentRun): number | null {
  if (run.started_at === null || run.finished_at === null) return null;
  const duration =
    (new Date(run.finished_at).getTime() - new Date(run.started_at).getTime()) / 1000;
  return Number.isFinite(duration) && duration >= 0 ? Math.round(duration) : null;
}
