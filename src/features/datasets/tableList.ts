/**
 * The Tables list: each table with its current snapshot and its status axes (#525).
 *
 * The status axes come with `GET /datasets`; the current snapshot's id, row count and
 * commit time come with `GET /warehouse/tables` itself since kpubdata-builder#841
 * (`current_snapshot`, and `dataset_id` naming the dataset a table was built for), so
 * the list needs no call per table. A dataset has one warehouse table per source.
 *
 * Tables are matched to datasets as the table detail matches them (`tableOwnerAmong`, #602).
 * An older Builder omits both fields: its tables are joined by `<dataset_id>.<source_key>`
 * and each current snapshot is read from `GET /warehouse/tables/{name}`, four at a time,
 * as before (#569). A value Builder did not send stays absent, and the page shows `—`.
 *
 * A deployment without a warehouse keeps today's list: the datasets alone, with no
 * snapshot columns.
 */
import { detectWarehouse } from "@/features/sql/warehouse";
import { type DatasetSummary, type WarehouseTable } from "@/shared/lib/builderApi";
import { warehouseApi } from "@/features/sql/warehouseApi";

import { listDatasets, mapWithConcurrency } from "./api";
import { tableOwnerAmong, type TableOwner } from "./warehouseTables";

/** The fields of a current snapshot the list shows: in the list summary and in the detail. */
export interface CurrentSnapshot {
  snapshot_id: string;
  row_count: number | null;
  committed_at: string | null;
}

/** One source table of a dataset, as the warehouse knows it. */
export interface SourceSnapshot {
  logicalName: string;
  sourceKey: string;
  /**
   * `null`: the table has no committed snapshot yet. `undefined`: it has one, but the
   * detail request failed or did not list it, or the list summary names its id without
   * the snapshot itself — not known, never "empty".
   */
  current: CurrentSnapshot | null | undefined;
}

export interface TableListRow extends DatasetSummary {
  /** `null` when the deployment has no warehouse. */
  snapshots: SourceSnapshot[] | null;
}

export interface TableList {
  warehouse: boolean;
  rows: TableListRow[];
}

/** The dataset a warehouse table belongs to, split at the last dot of `<dataset_id>.<source_key>`. */
export function splitLogicalName(logicalName: string): { datasetId: string; sourceKey: string } | null {
  const dot = logicalName.lastIndexOf(".");
  if (dot <= 0 || dot === logicalName.length - 1) return null;
  return { datasetId: logicalName.slice(0, dot), sourceKey: logicalName.slice(dot + 1) };
}

/**
 * The dataset and source of a warehouse table when no dataset ids are at hand (Home).
 * Builder's `dataset_id` wins when sent, and the source key is the rest of the name after
 * it (#602); null means Builder could not tell, and the table is not attributed. Only an
 * older Builder that omits it is read by splitting the name — the Tables list and the
 * table detail match such a table against the dataset ids instead (`tableOwnerAmong`).
 */
export function tableOwner(table: Pick<WarehouseTable, "logical_name" | "dataset_id">): TableOwner | null {
  if (table.dataset_id === undefined) return splitLogicalName(table.logical_name);
  if (table.dataset_id === null) return null;
  return tableOwnerAmong(table, [table.dataset_id]);
}

/**
 * The current snapshot of a table: from the list summary when Builder sends it (#841),
 * otherwise from the table's detail.
 *
 * A summary of `null` with a `current_snapshot_id` set means Builder knows a snapshot was
 * committed but could not find it in the catalog (#587). Studio treats that as unknown
 * (`undefined`, shown as `—`), never as "no commit yet".
 */
export async function currentSnapshotOf(table: WarehouseTable, signal?: AbortSignal): Promise<CurrentSnapshot | null | undefined> {
  if (table.current_snapshot === null && table.current_snapshot_id !== null) return undefined;
  if (table.current_snapshot !== undefined) return table.current_snapshot;
  if (table.current_snapshot_id === null) return null;
  try {
    const detail = await warehouseApi().getWarehouseTable(table.logical_name, signal);
    return detail.snapshots.find((snapshot) => snapshot.snapshot_id === table.current_snapshot_id);
  } catch (cause) {
    if (signal?.aborted) throw cause;
    // One table's failure leaves its cells unknown; the rest of the list still loads.
    return undefined;
  }
}

/**
 * The datasets, and — when there is a warehouse — each one's source tables with their
 * current snapshot. Detail requests, needed only for an older Builder, are capped at four
 * at a time.
 */
export async function loadTableList(signal?: AbortSignal): Promise<TableList> {
  const [datasets, warehouse] = await Promise.all([listDatasets(50, signal), detectWarehouse(signal)]);
  if (warehouse.status !== "available") {
    return { warehouse: false, rows: datasets.map((dataset) => ({ ...dataset, snapshots: null })) };
  }

  const listed = new Set(datasets.map((dataset) => dataset.dataset_id));
  const owned = warehouse.tables.flatMap((table) => {
    const owner = tableOwnerAmong(table, listed);
    return owner !== null ? [{ table, owner }] : [];
  });
  const currents = await mapWithConcurrency(owned, 4, ({ table }) => currentSnapshotOf(table, signal));

  const byDataset = new Map<string, SourceSnapshot[]>();
  owned.forEach(({ table, owner }, index) => {
    const entries = byDataset.get(owner.datasetId) ?? [];
    entries.push({ logicalName: table.logical_name, sourceKey: owner.sourceKey, current: currents[index] });
    byDataset.set(owner.datasetId, entries);
  });

  return {
    warehouse: true,
    rows: datasets.map((dataset) => ({ ...dataset, snapshots: byDataset.get(dataset.dataset_id) ?? [] })),
  };
}
