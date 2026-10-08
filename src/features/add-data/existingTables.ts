/**
 * Whether adding this dataset would replace a table that is already there (#837).
 *
 * A table is named `<dataset_id>.<source_key>`, and a dataset id made from the provider and
 * dataset name (`identity.ts`) is the same whatever the conditions asked for. Adding the
 * same dataset again — another station, another month — therefore commits a new revision
 * of the same table: the rows that were there are no longer its current snapshot. The
 * review step asks here first, and unless the user chooses the same id it builds under
 * one no table has yet.
 *
 * A file source is different: every upload is a source key of its own, so adding a file
 * under an id that has a table adds a second table beside it and replaces nothing. The
 * step still asks — the tables would share an id — and says which of the two it is.
 *
 * The caller's tables are read once (`GET /warehouse/tables`): the same answer says which
 * tables the id would replace and which suffixed id is free. A deployment without a
 * warehouse (404) keeps no table to replace. Any other failure is not read as "nothing
 * there" — the review step holds the build until the question has an answer.
 */
import { sourceKeyOf, sourceKeyUnder } from "@/features/datasets/warehouseTables";
import { warehouseApi } from "@/features/sql/warehouseApi";
import { ApiError, type WarehouseTable } from "@/shared/lib/builderApi";
import type { BuildSpec } from "@/shared/lib/types";

export type ExistingTables =
  /** Not asked yet, or the answer is on its way. */
  | { status: "checking" }
  /** No table of this dataset id: the build makes a new one. */
  | { status: "none" }
  /**
   * `tables` are there under the id. `replaced` are those among them the build would
   * commit to — the ones whose name is a name it makes; the rest only share the id.
   * `freeId` is the id under which nothing is there, and `freeNumber` its suffix.
   */
  | { status: "found"; tables: WarehouseTable[]; replaced: WarehouseTable[]; freeId: string; freeNumber: number }
  /** The tables could not be read. */
  | { status: "unknown" };

/** Under which id the build goes: one that has no table yet (the default), or the same one. */
export type ExistingTableChoice = "new" | "same";

/** Dataset ids are capped at this length by `slugify`; a suffix must fit inside it. */
const MAX_ID_LENGTH = 80;

/**
 * Whether building `sourceKeys` under `datasetId` could touch `table`.
 *
 * Wider than the Tables screen's ownership (`warehouseTables.ts`), on purpose. That
 * screen never guesses whose a table is; this asks whether one could be overwritten, and
 * a wrong "no" loses its rows. So a table Builder could not attribute (`dataset_id:
 * null` — it could not read the run's spec) counts when its name is under the id, and
 * any table counts whose name is exactly one the build would make, whatever dataset
 * Builder says it is: dataset `a` with source `b.c` and dataset `a.b` with source `c`
 * are the same table name.
 */
function touches(table: WarehouseTable, datasetId: string, sourceKeys: readonly string[]): boolean {
  if (sourceKeyOf(table, datasetId) !== null) return true;
  if (table.dataset_id === null && sourceKeyUnder(table.logical_name, datasetId) !== null) return true;
  return sourceKeys.some((key) => table.logical_name === `${datasetId}.${key}`);
}

/** `datasetId-2`, `-3`, …: the first under which the build touches no table in `tables`. */
export function freeDatasetId(
  datasetId: string,
  tables: WarehouseTable[],
  sourceKeys: readonly string[] = [],
): { id: string; number: number } {
  for (let number = 2; ; number += 1) {
    const suffix = `-${number}`;
    const id = `${datasetId.slice(0, MAX_ID_LENGTH - suffix.length)}${suffix}`;
    if (!tables.some((table) => touches(table, id, sourceKeys))) return { id, number };
  }
}

/**
 * The tables under `datasetId` among `tables`, as the review step needs to know them.
 * `sourceKeys` are the source keys Builder's preview gave; without them every table under
 * the id is taken to be one the build replaces — the answer that is safe to be wrong about.
 */
export function existingTablesAmong(
  datasetId: string,
  tables: WarehouseTable[],
  sourceKeys: readonly string[] = [],
): ExistingTables {
  const under = tables.filter((table) => touches(table, datasetId, sourceKeys));
  if (under.length === 0) return { status: "none" };
  const names = new Set(sourceKeys.map((key) => `${datasetId}.${key}`));
  const replaced = sourceKeys.length === 0 ? under : under.filter((table) => names.has(table.logical_name));
  const free = freeDatasetId(datasetId, tables, sourceKeys);
  return { status: "found", tables: under, replaced, freeId: free.id, freeNumber: free.number };
}

/** Ask Builder which tables are under `datasetId`. Rejects only when `signal` is aborted. */
export async function findExistingTables(
  datasetId: string,
  signal?: AbortSignal,
  sourceKeys: readonly string[] = [],
): Promise<ExistingTables> {
  try {
    const { tables } = await warehouseApi().listWarehouseTables(signal);
    return existingTablesAmong(datasetId, tables, sourceKeys);
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

/**
 * `spec` as it is submitted: under the free id, unless the user chose the same one. The
 * title takes the id's number too — two tables with one title cannot be told apart in a list.
 */
export function specToBuild(spec: BuildSpec, existing: ExistingTables, choice: ExistingTableChoice): BuildSpec {
  if (existing.status !== "found" || choice !== "new") return spec;
  return { ...spec, datasetId: existing.freeId, title: `${spec.title} (${existing.freeNumber})` };
}
