/**
 * The Tables list: each table with its current snapshot and its status axes (#525).
 *
 * Builder keeps the two halves in different places: the status axes come with
 * `GET /datasets`, and the current snapshot's row count and commit time only with
 * `GET /warehouse/tables/{name}`. A dataset has one warehouse table per source,
 * named `<dataset_id>.<source_key>`. This module joins them by that name and nothing
 * else — a value Builder did not send stays absent, and the page shows `—` for it.
 * builder#841 asks for the snapshot summary in the list itself, which would remove the
 * per-table detail requests.
 *
 * A deployment without a warehouse keeps today's list: the datasets alone, with no
 * snapshot columns.
 */
import { detectWarehouse } from "@/features/sql/warehouse";
import { type DatasetSummary, type WarehouseSnapshot, type WarehouseTable } from "@/shared/lib/builderApi";
import { warehouseApi } from "@/features/sql/warehouseApi";

import { listDatasets, mapWithConcurrency } from "./api";

/** One source table of a dataset, as the warehouse knows it. */
export interface SourceSnapshot {
  logicalName: string;
  sourceKey: string;
  /**
   * `null`: the table has no committed snapshot yet. `undefined`: it has one, but the
   * detail request failed or did not list it — not known, never "empty".
   */
  current: WarehouseSnapshot | null | undefined;
}

export interface TableListRow extends DatasetSummary {
  /** `null` when the deployment has no warehouse. */
  snapshots: SourceSnapshot[] | null;
}

export interface TableList {
  warehouse: boolean;
  rows: TableListRow[];
}

/** The dataset a warehouse table belongs to, by the contract's `<dataset_id>.<source_key>`. */
export function splitLogicalName(logicalName: string): { datasetId: string; sourceKey: string } | null {
  const dot = logicalName.lastIndexOf(".");
  if (dot <= 0 || dot === logicalName.length - 1) return null;
  return { datasetId: logicalName.slice(0, dot), sourceKey: logicalName.slice(dot + 1) };
}

async function currentSnapshotOf(table: WarehouseTable, signal?: AbortSignal): Promise<WarehouseSnapshot | null | undefined> {
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
 * current snapshot. Detail requests are capped at four at a time, as the quality fan-out
 * this replaces was.
 */
export async function loadTableList(signal?: AbortSignal): Promise<TableList> {
  const [datasets, warehouse] = await Promise.all([listDatasets(50, signal), detectWarehouse(signal)]);
  if (warehouse.status !== "available") {
    return { warehouse: false, rows: datasets.map((dataset) => ({ ...dataset, snapshots: null })) };
  }

  const listed = new Set(datasets.map((dataset) => dataset.dataset_id));
  const owned = warehouse.tables.filter((table) => {
    const name = splitLogicalName(table.logical_name);
    return name !== null && listed.has(name.datasetId);
  });
  const currents = await mapWithConcurrency(owned, 4, (table) => currentSnapshotOf(table, signal));

  const byDataset = new Map<string, SourceSnapshot[]>();
  owned.forEach((table, index) => {
    const name = splitLogicalName(table.logical_name)!;
    const entries = byDataset.get(name.datasetId) ?? [];
    entries.push({ logicalName: table.logical_name, sourceKey: name.sourceKey, current: currents[index] });
    byDataset.set(name.datasetId, entries);
  });

  return {
    warehouse: true,
    rows: datasets.map((dataset) => ({ ...dataset, snapshots: byDataset.get(dataset.dataset_id) ?? [] })),
  };
}
