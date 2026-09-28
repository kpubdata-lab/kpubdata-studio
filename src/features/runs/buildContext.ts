/**
 * Normalize Builds screen URL context (run/dataset/source/stage) (#379 split from BuildsPage).
 *
 * Use only loaded surfaces from Builder response — never guess unknown values to URL.
 */
import { parse as parseYaml } from "yaml";

import { collectFailureEvidence, type RunStatusFilter } from "@/features/runs/model";
import type { AsyncState } from "@/features/runs/asyncState";
import type { BuildSpecSnapshotResponse, RunStagesResponse } from "@/shared/lib/builderApi";
import type { BuildRunStatus } from "@/shared/lib/types";

export function buildStatusFilters(t: (key: string) => string): { value: RunStatusFilter; label: string }[] {
  return [
    { value: "all", label: t("builds.statusFilter.all") },
    { value: "succeeded", label: t("builds.statusFilter.succeeded") },
    { value: "failed", label: t("builds.statusFilter.failed") },
    { value: "running", label: t("builds.statusFilter.running") },
    { value: "queued", label: t("builds.statusFilter.queued") },
    { value: "cancelled", label: t("builds.statusFilter.cancelled") },
  ];
}


/** Normalize Builds Kubi context query using only loaded surfaces from Builder response. */
export function normalizeBuildContextSearch(
  searchParams: URLSearchParams,
  specState: AsyncState<BuildSpecSnapshotResponse>,
  stagesState: AsyncState<RunStagesResponse>,
): URLSearchParams {
  const next = new URLSearchParams(searchParams);

  if (specState.status === "loaded") {
    const datasetId = extractDatasetId(specState.data.spec);
    if (datasetId) next.set("dataset", datasetId);
    else next.delete("dataset");
  }

  if (stagesState.status === "loaded") {
    const sources = stagesState.data.sources;
    const failureEvidence = collectFailureEvidence(sources);
    const requestedStage = next.get("stage");
    const selectedSource = next.get("source");
    const selectedSourceEntry = selectedSource
      ? sources.find((source) => source.source_key === selectedSource)
      : sources.length === 1
        ? sources[0]
        : undefined;
    const requestedStageAvailable =
      (requestedStage === "bronze" || requestedStage === "silver" || requestedStage === "gold") &&
      Boolean(selectedSourceEntry && selectedSourceEntry[requestedStage].status !== "not_run");
    // Use failedStage as safe context only if exactly one failure exists; if source selected,
    // must be that source's failure — don't attach different source's stage to current source
    // creating impossible source/stage combo (unverified evidence).
    const failureFallback =
      failureEvidence.length === 1 &&
      (!selectedSource || failureEvidence[0].sourceKey === selectedSource)
        ? failureEvidence[0].failedStage
        : null;
    const stage = requestedStageAvailable ? requestedStage : failureFallback;

    if (stage) next.set("stage", stage);
    else next.delete("stage");

    const sourceKeys = sources.map((source) => source.source_key);
    if (stage && sourceKeys.length === 1) next.set("source", sourceKeys[0]);
    else if (selectedSource && !sourceKeys.includes(selectedSource)) next.delete("source");
  }

  return next;
}



/** Safely extract only dataset_id from BuildSpec snapshot YAML. Parse failure silently returns null (no guessing). */
export function extractDatasetId(specYaml: string): string | null {
  try {
    const parsed = parseYaml(specYaml) as unknown;
    if (parsed && typeof parsed === "object" && "dataset_id" in parsed) {
      const value = (parsed as Record<string, unknown>).dataset_id;
      return typeof value === "string" && value.length > 0 ? value : null;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Use Builder job status as-is for screen state.
 *
 * Previously collapsed cancelling into running, but "cancelling" and "running" are distinct
 * states — whether user sent cancel request differs. Don't reclassify Builder's status to
 * different state (#255 follow-up). BuildRunStatus/StatusBadge directly supports cancelling.
 */
export function mapLiveStatus(status: "queued" | "running" | "cancelling" | "succeeded" | "failed" | "cancelled"): BuildRunStatus {
  return status;
}
