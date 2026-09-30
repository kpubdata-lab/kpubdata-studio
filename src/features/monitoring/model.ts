/**
 * Shared Monitoring-domain models (#264, #303).
 *
 * State vocabulary and pure helpers shared by the page and tab components.
 * The wire-schema types' canon is `@/shared/lib/builderApi.schema`.
 */
import { i18n } from "@/shared/i18n";
import type {
  MonitoringRecentRun,
  MonitoringSummaryResponse,
  MonitoringBuildsResponse,
} from "@/shared/lib/builderApi.schema";

export type MonitoringTab = "system" | "builds" | "recent-runs";

export type MonitoringLoadingState = "idle" | "loading" | "success" | "error";

/** Screen model bundling the parallel /monitoring/summary + /monitoring/builds lookups (#302). */
export interface MonitoringData {
  summary: MonitoringSummaryResponse;
  builds: MonitoringBuildsResponse;
}

/** Maps BuildIndex internal status values (ok/failed/cancelled etc.) to display labels. */
export function runStatusLabel(status: string): { label: string; className: string } {
  switch (status) {
    case "ok":
    case "succeeded":
      return {
        label: i18n.t("monitoring.runStatus.succeeded"),
        className: "bg-status-success-subtle text-status-success",
      };
    case "failed":
      return {
        label: i18n.t("monitoring.runStatus.failed"),
        className: "bg-status-failure-subtle text-status-failure",
      };
    case "running":
      return {
        label: i18n.t("monitoring.runStatus.running"),
        className: "bg-blue-100 text-blue-800 dark:bg-blue-950/50 dark:text-blue-300",
      };
    case "cancelled":
      return {
        label: i18n.t("monitoring.runStatus.cancelled"),
        className: "bg-muted text-muted-foreground",
      };
    case "queued":
      return {
        label: i18n.t("monitoring.runStatus.queued"),
        className: "bg-status-warning-subtle text-status-warning",
      };
    default:
      return { label: status, className: "bg-muted text-muted-foreground" };
  }
}

/** Computes elapsed seconds from started/finished timestamps — builder sends no duration. */
export function runDurationSeconds(run: MonitoringRecentRun): number | null {
  if (run.started_at === null || run.finished_at === null) return null;
  const duration =
    (new Date(run.finished_at).getTime() - new Date(run.started_at).getTime()) / 1000;
  return Number.isFinite(duration) && duration >= 0 ? Math.round(duration) : null;
}
