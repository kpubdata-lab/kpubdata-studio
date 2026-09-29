/**
 * Query committed warehouse tables and keep analyses (#417).
 *
 * KPubData Builder's warehouse (builder#797) keeps each table's snapshots; a query pins
 * one at the start, and a saved analysis (builder#783) stores that concrete snapshot id,
 * so re-running it reads the same input after the table has been refreshed. A deployment
 * without a warehouse answers 404 `warehouse_not_configured`; the SQL Workspace then
 * keeps querying runs directly (`features/sql/api.ts`), where nothing can be saved.
 */
import {
  builderApi,
  isRealBuilderEnabled,
  type QueryResponse,
  type SavedAnalysis,
  type WarehouseQueryResponse,
  type WarehouseTable,
} from "@/shared/lib/builderApi";

import { classifyQueryError } from "./api";

export type WarehouseAvailability =
  | { status: "loading" }
  | { status: "available"; tables: WarehouseTable[] }
  | { status: "unavailable" };

/** Whether this deployment has a warehouse the caller can query. */
export async function detectWarehouse(signal?: AbortSignal): Promise<WarehouseAvailability> {
  if (!isRealBuilderEnabled()) return { status: "unavailable" };
  try {
    return { status: "available", tables: (await builderApi.listWarehouseTables(signal)).tables };
  } catch {
    // 404 is "no warehouse here"; anything else also leaves the run-based path, which
    // still works, rather than a screen that cannot query at all.
    return { status: "unavailable" };
  }
}

/** What a result read: table and concrete snapshot, with the revision when the Builder said. */
export interface Pinned {
  table: string;
  snapshotId: string;
  revision?: number;
}

export type WarehouseOutcome =
  | { status: "success"; result: QueryResponse; pinned: Pinned; saved?: SavedAnalysis }
  | { status: "error"; code: string; message: string };

function fromResponse(response: WarehouseQueryResponse): WarehouseOutcome {
  const { logical_name, snapshot_id, revision } = response.snapshot;
  return { status: "success", result: response.result, pinned: { table: logical_name, snapshotId: snapshot_id, revision } };
}

export async function queryWarehouse(
  table: string,
  snapshot: string,
  sql: string,
  signal?: AbortSignal,
): Promise<WarehouseOutcome> {
  try {
    return fromResponse(await builderApi.warehouseQuery({ table, snapshot, sql }, signal));
  } catch (cause) {
    return classifyQueryError(cause);
  }
}

/** Run once and save — the Builder stores the snapshot the run actually read. */
export async function saveAnalysis(
  name: string,
  table: string,
  snapshot: string,
  sql: string,
  signal?: AbortSignal,
): Promise<WarehouseOutcome> {
  try {
    const { analysis, result } = await builderApi.createAnalysis({ name, table, snapshot, sql }, signal);
    const binding = analysis.bindings[0];
    return {
      status: "success",
      saved: analysis,
      result,
      pinned: { table: binding?.table ?? table, snapshotId: binding?.snapshot_id ?? snapshot },
    };
  } catch (cause) {
    return classifyQueryError(cause);
  }
}

export async function rerunAnalysis(analysisId: string, signal?: AbortSignal): Promise<WarehouseOutcome> {
  try {
    return fromResponse(await builderApi.runAnalysis(analysisId, signal));
  } catch (cause) {
    return classifyQueryError(cause);
  }
}
