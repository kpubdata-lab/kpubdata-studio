/**
 * Which dataset a warehouse table belongs to, and under which source key (#526, #602).
 *
 * Builder names a warehouse table `<dataset_id>.<source_key>` and reads it back the same
 * way (`table_key`): the source key is everything after the `<dataset_id>.` prefix. Both
 * halves may contain dots — a dataset id such as `seoul.air`, and a source key such as
 * `datago.air_quality`, which is what a public-API source without an alias is keyed by —
 * so the name cannot be split at any one dot. The Tables list and the table detail both
 * decide ownership here:
 *
 * - `dataset_id` set: Builder says which dataset built the table (kpubdata-builder#841);
 *   the table belongs to that dataset only.
 * - `dataset_id` null: Builder could not tell. The table is not attributed to any dataset
 *   and never guessed from its name (#569).
 * - `dataset_id` omitted: an older Builder that does not send it. The table belongs to the
 *   longest candidate dataset id its name starts with, followed by a dot.
 */
import type { WarehouseTable } from "@/shared/lib/builderApi";

export interface TableOwner {
  datasetId: string;
  sourceKey: string;
}

/** Builder's `table_key`: the rest of `logicalName` after `<datasetId>.`, or `null`. */
export function sourceKeyUnder(logicalName: string, datasetId: string): string | null {
  const prefix = `${datasetId}.`;
  if (datasetId === "" || !logicalName.startsWith(prefix) || logicalName.length === prefix.length) return null;
  return logicalName.slice(prefix.length);
}

/** The dataset among `datasetIds` that `table` belongs to, with its source key, or `null`. */
export function tableOwnerAmong(
  table: Pick<WarehouseTable, "logical_name" | "dataset_id">,
  datasetIds: Iterable<string>,
): TableOwner | null {
  const name = table.logical_name;
  if (table.dataset_id === null) return null;
  if (table.dataset_id !== undefined) {
    const datasetId = table.dataset_id;
    if (![...datasetIds].includes(datasetId)) return null;
    return { datasetId, sourceKey: sourceKeyUnder(name, datasetId) ?? name };
  }
  let owner: TableOwner | null = null;
  for (const datasetId of datasetIds) {
    const sourceKey = sourceKeyUnder(name, datasetId);
    if (sourceKey !== null && (owner === null || datasetId.length > owner.datasetId.length)) owner = { datasetId, sourceKey };
  }
  return owner;
}

/** The source key of `table` when it belongs to `datasetId`, else `null`. */
export function sourceKeyOf(table: Pick<WarehouseTable, "logical_name" | "dataset_id">, datasetId: string): string | null {
  return tableOwnerAmong(table, [datasetId])?.sourceKey ?? null;
}

/** The warehouse tables of one dataset, in Builder's order. */
export function datasetTablesOf(tables: WarehouseTable[], datasetId: string): WarehouseTable[] {
  return tables.filter((table) => sourceKeyOf(table, datasetId) !== null);
}
