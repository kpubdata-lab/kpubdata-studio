/**
 * A dataset's warehouse tables (#526).
 *
 * The contract names a warehouse table `<dataset_id>.<source_key>` and gives no other
 * link between the two, so the name is split at its last dot — the same reading as the
 * SQL Workspace's table explorer.
 */
import type { WarehouseTable } from "@/shared/lib/builderApi";

/** The source key of `logicalName` when it belongs to `datasetId`, else `null`. */
export function sourceKeyOf(logicalName: string, datasetId: string): string | null {
  const dot = logicalName.lastIndexOf(".");
  if (dot <= 0 || dot === logicalName.length - 1) return null;
  return logicalName.slice(0, dot) === datasetId ? logicalName.slice(dot + 1) : null;
}

/** The warehouse tables of one dataset, in Builder's order. */
export function datasetTablesOf(tables: WarehouseTable[], datasetId: string): WarehouseTable[] {
  return tables.filter((table) => sourceKeyOf(table.logical_name, datasetId) !== null);
}
