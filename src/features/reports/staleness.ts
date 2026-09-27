/**
 * Determine if saved Report's base dataset/run still valid (#258 §8).
 *
 * When reopening Report, re-verify base evidence "within possible range", but never erase saved
 * content or auto-replace with latest run — this module judges state only; UI decides what to show.
 *
 * Four states only:
 * - CURRENT: base run same as dataset's latest run (re-verifiable, latest).
 * - STALE: base run still accessible but newer run appeared.
 * - ORPHAN: run list fetch succeeded but base run no longer in list (deleted or access lost).
 * - UNAVAILABLE: run list fetch failed; cannot determine which of above three.
 */
import { i18n } from "@/shared/i18n";
import { getDataset, listDatasetRuns } from "@/features/datasets/api";
import type { EvidenceRunStatus } from "./types";

export interface EvidenceStalenessResult {
  status: EvidenceRunStatus;
  /** Latest run of dataset at judgment time (only if verification succeeded). */
  latestRunId?: string;
  /** Human-readable reason when STALE/ORPHAN/UNAVAILABLE. */
  reason?: string;
  checkedAt: string;
}

async function settle<T>(promise: Promise<T>): Promise<{ ok: true; value: T } | { ok: false; reason: string }> {
  try {
    return { ok: true, value: await promise };
  } catch (cause) {
    return { ok: false, reason: cause instanceof Error ? cause.message : i18n.t("reports.staleness.lookupFailed") };
  }
}

/**
 * @param datasetId - Base dataset fixed by Report.
 * @param baseRunId - Base run fixed by Report (not modified).
 * @param signal - Abort signal.
 */
export async function checkReportEvidenceStatus(
  datasetId: string,
  baseRunId: string,
  signal?: AbortSignal,
): Promise<EvidenceStalenessResult> {
  const checkedAt = new Date().toISOString();
  const [datasetResult, runsResult] = await Promise.all([
    settle(getDataset(datasetId, signal)),
    settle(listDatasetRuns(datasetId, 50, signal)),
  ]);

  if (!runsResult.ok) {
    return {
      status: "unavailable",
      reason: i18n.t("reports.staleness.runsReloadFailed", { reason: runsResult.reason }),
      checkedAt,
    };
  }

  const stillExists = runsResult.value.runs.some((run) => run.run_id === baseRunId);
  if (!stillExists) {
    return {
      status: "orphan",
      reason: i18n.t("reports.staleness.runGone"),
      checkedAt,
    };
  }

  // Builder response maintains order with latest run first (same basis as dataset.latest_run_id).
  const latestRunId = datasetResult.ok ? datasetResult.value.latest_run_id : runsResult.value.runs[0]?.run_id;

  if (latestRunId && latestRunId !== baseRunId) {
    return { status: "stale", latestRunId, reason: i18n.t("reports.staleness.newerRun", { runId: latestRunId }), checkedAt };
  }

  return { status: "current", latestRunId, checkedAt };
}
