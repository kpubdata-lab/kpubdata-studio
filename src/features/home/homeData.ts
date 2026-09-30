/**
 * What Home leads with (#527): tables that need attention, recent snapshots, recent
 * analyses and connection problems — all read from contract fields, nothing inferred.
 *
 * - Attention comes from each dataset's `status_axes` (`GET /datasets`).
 * - Recent snapshots are each warehouse table's current snapshot, newest commit first,
 *   from the `GET /warehouse/tables` summary (kpubdata-builder#841); an older Builder's
 *   tables are read from `GET /warehouse/tables/{name}`, four at a time.
 * - Connection problems group the tables whose Access axis needs action by provider.
 */
import { kindOf } from "@/features/datasets/components/StatusAxes";
import { tableOwner, type CurrentSnapshot } from "@/features/datasets/tableList";
import { type DatasetSummary, type WarehouseSnapshot, type WarehouseTable } from "@/shared/lib/builderApi";
import { warehouseApi } from "@/features/sql/warehouseApi";
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
  /** The table's dataset and source, when known (see `tableOwner`). */
  owner: { datasetId: string; sourceKey: string } | null;
  /**
   * The current snapshot. `run_id` and `created_at` come only from a table's detail — the
   * list summary (kpubdata-builder#841) does not carry them — so they may be absent.
   */
  snapshot: CurrentSnapshot & Partial<Pick<WarehouseSnapshot, "run_id" | "created_at">>;
}

/**
 * The current snapshots of `tables`, newest commit first, at most `limit`. They come from
 * the list summary (#841); only a table an older Builder lists without one is read from
 * its detail, four at a time. A table whose detail request fails is left out rather than
 * shown with guessed values.
 */
export async function loadRecentSnapshots(tables: WarehouseTable[], limit: number, signal?: AbortSignal): Promise<RecentSnapshot[]> {
  const found: RecentSnapshot[] = [];
  const needDetail: WarehouseTable[] = [];
  for (const table of tables) {
    if (table.current_snapshot) found.push({ logicalName: table.logical_name, owner: tableOwner(table), snapshot: table.current_snapshot });
    else if (table.current_snapshot === undefined && table.current_snapshot_id !== null) needDetail.push(table);
  }
  let next = 0;
  async function worker() {
    while (next < needDetail.length) {
      const table = needDetail[next++];
      try {
        const detail = await warehouseApi().getWarehouseTable(table.logical_name, signal);
        const snapshot = detail.snapshots.find((item) => item.snapshot_id === table.current_snapshot_id);
        if (snapshot) found.push({ logicalName: table.logical_name, owner: tableOwner(table), snapshot });
      } catch (cause) {
        if (signal?.aborted) throw cause;
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(4, needDetail.length) }, worker));
  const time = (entry: RecentSnapshot) => Date.parse(entry.snapshot.committed_at ?? entry.snapshot.created_at ?? "") || 0;
  return found.sort((a, b) => time(b) - time(a)).slice(0, limit);
}
