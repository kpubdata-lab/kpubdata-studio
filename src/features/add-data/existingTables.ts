/**
 * Whether adding this dataset would replace a table that is already there (#837).
 *
 * A table is named `<dataset_id>.<source_key>`, and a dataset id made from the provider and
 * dataset name (`identity.ts`) is the same whatever the conditions asked for. Adding the
 * same dataset again — another station, another month — therefore commits a new revision
 * of the same table: the rows that were there are no longer its current snapshot. The
 * review step asks here first, and unless the user chooses to refresh the table it builds
 * under an id no table has yet.
 *
 * The caller's tables are read once (`GET /warehouse/tables`): the same answer says which
 * tables the id would replace and which suffixed id is free. A deployment without a
 * warehouse (404) keeps no table to replace. Any other failure is not read as "nothing
 * there" — the review step holds the build until the question has an answer.
 */
import { datasetTablesOf } from "@/features/datasets/warehouseTables";
import { warehouseApi } from "@/features/sql/warehouseApi";
import { ApiError, type WarehouseTable } from "@/shared/lib/builderApi";
import type { BuildSpec } from "@/shared/lib/types";

export type ExistingTables =
  /** Not asked yet, or the answer is on its way. */
  | { status: "checking" }
  /** No table of this dataset id: the build makes a new one. */
  | { status: "none" }
  /** Tables the build would replace, and the id that would not replace any. */
  | { status: "found"; tables: WarehouseTable[]; freeId: string }
  /** The tables could not be read. */
  | { status: "unknown" };

/** What the user does about a table that is already there. A new table is the default. */
export type ExistingTableChoice = "new" | "refresh";

/** Dataset ids are capped at this length by `slugify`; a suffix must fit inside it. */
const MAX_ID_LENGTH = 80;

/** `datasetId`, then `datasetId-2`, `-3`, …: the first that owns no table in `tables`. */
export function freeDatasetId(datasetId: string, tables: WarehouseTable[]): string {
  for (let n = 2; ; n += 1) {
    const suffix = `-${n}`;
    const candidate = `${datasetId.slice(0, MAX_ID_LENGTH - suffix.length)}${suffix}`;
    if (datasetTablesOf(tables, candidate).length === 0) return candidate;
  }
}

/** The tables of `datasetId` among `tables`, as the review step needs to know them. */
export function existingTablesAmong(datasetId: string, tables: WarehouseTable[]): ExistingTables {
  const own = datasetTablesOf(tables, datasetId);
  if (own.length === 0) return { status: "none" };
  return { status: "found", tables: own, freeId: freeDatasetId(datasetId, tables) };
}

/** Ask Builder which tables `datasetId` already has. Rejects only when `signal` is aborted. */
export async function findExistingTables(datasetId: string, signal?: AbortSignal): Promise<ExistingTables> {
  try {
    const { tables } = await warehouseApi().listWarehouseTables(signal);
    return existingTablesAmong(datasetId, tables);
  } catch (cause) {
    if (signal?.aborted) throw cause;
    if (cause instanceof ApiError && cause.status === 404) return { status: "none" };
    return { status: "unknown" };
  }
}

/** The dataset id the build goes under, given what is there and what the user chose. */
export function datasetIdToBuild(datasetId: string, existing: ExistingTables, choice: ExistingTableChoice): string {
  return existing.status === "found" && choice === "new" ? existing.freeId : datasetId;
}

/** `spec` as it is submitted: under the free id unless the user chose to refresh the table. */
export function specToBuild(spec: BuildSpec, existing: ExistingTables, choice: ExistingTableChoice): BuildSpec {
  const datasetId = datasetIdToBuild(spec.datasetId, existing, choice);
  return datasetId === spec.datasetId ? spec : { ...spec, datasetId };
}
