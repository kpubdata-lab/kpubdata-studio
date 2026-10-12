/**
 * The refresh history in Studio's model (#902): Builder's `GET /builds` rows mapped, and
 * the demo's fixture runs.
 *
 * Kept apart from the runs client so the client, `getBuild` and `listBuilds` can all read
 * it without importing each other.
 */
import type { BuildSummary } from "@/shared/lib/builderApi";
import { DEMO_DATASETS, type DemoDataset } from "@/shared/lib/demoDatasets";
import type { BuildListItem, BuildRun, BuildRunStatus, BuildSpec } from "@/shared/lib/types";

/**
 * Map Builder `GET /builds` BuildSummary.status (canonical vocab: ok/failed/cancelled)
 * to Studio BuildRunStatus.
 *
 * Cancelled runs come as `cancelled` and never collapse to failed (#S04). Values
 * outside Builder vocab fail-closed (failed), not silently as success.
 */
function mapBuildSummaryStatus(status: BuildSummary["status"]): BuildRunStatus {
  switch (status) {
    case "ok":
      return "succeeded";
    case "cancelled":
      return "cancelled";
    case "failed":
      return "failed";
    default:
      return "failed";
  }
}

/** Convert demo catalog entry to BuildSpec for list/history UI. */
function mockSpec(dataset: DemoDataset): BuildSpec {
  return {
    datasetId: dataset.slug,
    title: dataset.title,
    description: dataset.description,
    sources: [
      {
        provider: "datago",
        dataset: dataset.providerDataset,
        params: dataset.params,
      },
    ],
    exports: dataset.exports,
    metadata: {
      source_url: dataset.sourceUrl,
      hf_repo: dataset.hfRepo,
    },
  };
}

/** Deterministic build history for mock mode (based on real builder dataset specs). */
export function mockBuilds(): BuildRun[] {
  return DEMO_DATASETS.map((dataset) => ({
    id: dataset.buildId,
    spec: mockSpec(dataset),
    status: dataset.status,
    startedAt: dataset.startedAt,
    finishedAt: dataset.finishedAt,
  }));
}

/**
 * One `GET /builds` row as a list item. The table and snapshot fields
 * (kpubdata-builder#844) keep `undefined` when an older Builder omits them, so the table
 * can tell "not sent" from "sent as null".
 */
export function mapBuildSummary(summary: BuildSummary): BuildListItem {
  return {
    id: summary.run_id,
    title: summary.dataset_title ?? null,
    status: mapBuildSummaryStatus(summary.status),
    // Normalize missing or null to explicit null.
    startedAt: summary.started_at ?? null,
    finishedAt: summary.finished_at ?? null,
    datasetId: summary.dataset_id,
    snapshotId: summary.snapshot_id,
    snapshots: summary.snapshots?.map((entry) => ({
      logicalName: entry.logical_name,
      snapshotId: entry.snapshot_id,
    })),
  };
}


/**
 * The demo's history as list items. The demo runs name their table; they committed no
 * warehouse snapshot, so the snapshot fields stay unsent.
 */
export function demoHistory(): BuildListItem[] {
  return mockBuilds().map((run) => ({
    id: run.id,
    title: run.spec.title,
    status: run.status,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt ?? null,
    datasetId: run.spec.datasetId,
  }));
}
