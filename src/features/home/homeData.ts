/**
 * What Home leads with (#527): tables that need attention, recent snapshots, recent
 * analyses and connection problems — all read from contract fields, nothing inferred.
 *
 * - Attention comes from each dataset's `status_axes` (`GET /datasets`).
 * - Recent snapshots are each warehouse table's current snapshot
 *   (`GET /warehouse/tables/{name}`, four at a time), newest commit first. builder#841
 *   asks for the snapshot summary in the table list, which would remove those requests.
 * - Connection problems group the tables whose Access axis needs action by provider.
 */
import { kindOf } from "@/features/datasets/components/StatusAxes";
import { builderApi, type DatasetSummary, type WarehouseSnapshot, type WarehouseTable } from "@/shared/lib/builderApi";
import type { DatasetStatusAxes } from "@/shared/lib/builderApi.schema";

/** The axes Home treats as attention. Maturity is a grade, never a problem. */
const ATTENTION_AXES = ["health", "completeness", "refresh", "access"] as const;
export type AttentionAxis = (typeof ATTENTION_AXES)[number];

/**
 * The axes of one table that need attention: Stale, Degraded, Partial, Failed and any
 * Access problem (#527). A cancelled refresh is someone's decision, not a problem, and
 * `unknown` or a missing axis is not evidence of one.
 */
export function attentionAxes(axes: Partial<DatasetStatusAxes> | undefined): AttentionAxis[] {
  if (!axes) return [];
  return ATTENTION_AXES.filter((axis) => {
    if (axis === "refresh" && axes.refresh === "cancelled") return false;
    return kindOf(axis, axes[axis]).kind === "actionable";
  });
}

export interface ConnectionProblem {
  provider: string;
  access: NonNullable<DatasetStatusAxes["access"]>;
  datasetIds: string[];
}

/** Tables whose Access needs action, grouped by provider and access value. */
export function connectionProblems(datasets: DatasetSummary[]): ConnectionProblem[] {
  const groups = new Map<string, ConnectionProblem>();
  for (const dataset of datasets) {
    const access = dataset.status_axes?.access;
    if (!access || kindOf("access", access).kind !== "actionable") continue;
    for (const provider of new Set(dataset.sources.map((source) => source.provider))) {
      const key = `${provider}\u0000${access}`;
      const group = groups.get(key) ?? { provider, access, datasetIds: [] };
      group.datasetIds.push(dataset.dataset_id);
      groups.set(key, group);
    }
  }
  return [...groups.values()];
}

export interface RecentSnapshot {
  logicalName: string;
  snapshot: WarehouseSnapshot;
}

/** `<dataset_id>.<source_key>`, split at the last dot as the SQL Workspace does. */
export function splitTableName(logicalName: string): { datasetId: string; sourceKey: string } | null {
  const dot = logicalName.lastIndexOf(".");
  if (dot <= 0 || dot === logicalName.length - 1) return null;
  return { datasetId: logicalName.slice(0, dot), sourceKey: logicalName.slice(dot + 1) };
}

/**
 * The current snapshots of `tables`, newest commit first, at most `limit`. A table whose
 * detail request fails is left out rather than shown with guessed values.
 */
export async function loadRecentSnapshots(tables: WarehouseTable[], limit: number, signal?: AbortSignal): Promise<RecentSnapshot[]> {
  const committed = tables.filter((table) => table.current_snapshot_id !== null);
  const found: RecentSnapshot[] = [];
  let next = 0;
  async function worker() {
    while (next < committed.length) {
      const table = committed[next++];
      try {
        const detail = await builderApi.getWarehouseTable(table.logical_name, signal);
        const snapshot = detail.snapshots.find((item) => item.snapshot_id === table.current_snapshot_id);
        if (snapshot) found.push({ logicalName: table.logical_name, snapshot });
      } catch (cause) {
        if (signal?.aborted) throw cause;
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(4, committed.length) }, worker));
  const time = (entry: RecentSnapshot) => Date.parse(entry.snapshot.committed_at ?? entry.snapshot.created_at) || 0;
  return found.sort((a, b) => time(b) - time(a)).slice(0, limit);
}
