/**
 * The demo warehouse (#530): the tables and snapshots the demo shows when no Builder is
 * connected (GitHub Pages, `npm run dev` without `VITE_USE_REAL_BUILDER`).
 *
 * The demo leads with what a warehouse Builder sends — a table's `logical_name`, its
 * snapshot ids, row counts, commit times, the producing run and the snapshot state — and
 * nothing more. Each table is `<dataset_id>.<source_key>` of a dataset in `MOCK_DATASETS`,
 * and each snapshot is produced by a run in `MOCK_RUNS`, so the Tables list, Table Detail,
 * Home and the SQL Workspace tell one story.
 *
 * What the contract does not carry is not made up here: no institution name, no licence,
 * no column description or label, and no snapshot coverage (it stays `null`, which the
 * screens read as unknown). Every fixture is checked against the contract's zod schemas
 * in `__tests__/demoFixturesContract.test.ts`, which also fails on a field the schema
 * would strip.
 *
 * Nothing is computed in the demo. Row pages are generated deterministically from the
 * row index so paging holds together; a filtered or sorted page, a column profile, a
 * query, an aggregate, an export or a saved analysis would need a Builder, so the demo
 * answers those with a `demo` error instead of a made-up result.
 */
import { i18n } from "@/shared/i18n";
import {
  ApiError,
  type builderApi,
  type WarehouseRowsRequest,
  type WarehouseRowsResponse,
  type WarehouseSnapshot,
  type WarehouseTable,
} from "@/shared/lib/builderApi";
import type { ColumnWireInfo, WarehouseTableDetailResponse } from "@/shared/lib/builderApi.schema";

interface DemoColumn {
  meta: ColumnWireInfo;
  /** The value of this column in row `index` (0-based). */
  value: (index: number) => string | number;
}

export interface DemoTable {
  table: WarehouseTable;
  /** Newest first, as `GET /warehouse/tables/{name}` lists them. */
  snapshots: WarehouseSnapshot[];
  columns: DemoColumn[];
}

function column(name: string, logicalType: string, value: DemoColumn["value"]): DemoColumn {
  const wire = logicalType === "string" ? "string" : "number";
  return { meta: { name, logical_type: logicalType, wire_encoding: wire }, value };
}

/** Hourly timestamps from a fixed start, so a page is the same on every load. */
function hourly(start: string): (index: number) => string {
  const base = Date.parse(start);
  return (index) => new Date(base + index * 3_600_000).toISOString();
}

function snapshot(
  snapshotId: string,
  runId: string,
  rowCount: number | null,
  createdAt: string,
  committedAt: string | null,
): WarehouseSnapshot {
  return {
    snapshot_id: snapshotId,
    run_id: runId,
    state: committedAt === null ? "quarantined" : "committed",
    row_count: rowCount,
    created_at: createdAt,
    committed_at: committedAt,
    // Not recorded in the demo: unknown, never complete.
    coverage: null,
  };
}

const STATIONS = ["ST-01", "ST-02", "ST-03", "ST-04"];

const DEMO_TABLES: DemoTable[] = [
  {
    table: { table_id: "tbl_001", logical_name: "air-quality.datago__air", current_snapshot_id: "snap_012", revision: 2 },
    snapshots: [
      snapshot("snap_012", "air-2026-08-14", 1000, "2026-08-14T07:20:00Z", "2026-08-14T07:21:00Z"),
      snapshot("snap_011", "air-2026-08-13", 1000, "2026-08-13T07:15:00Z", "2026-08-13T07:16:00Z"),
    ],
    columns: [
      column("station_id", "string", (index) => STATIONS[index % STATIONS.length]),
      column("observed_at", "string", hourly("2026-08-04T00:00:00Z")),
      column("pm10", "float64", (index) => 18 + ((index * 7) % 29)),
      column("pm25", "float64", (index) => 9 + ((index * 5) % 17)),
    ],
  },
  {
    // The 08-14 run failed at silver for this source: its snapshot was quarantined and the
    // table still reads the 08-13 one.
    table: { table_id: "tbl_002", logical_name: "air-quality.kma__weather", current_snapshot_id: "snap_010", revision: 1 },
    snapshots: [
      snapshot("snap_013", "air-2026-08-14", null, "2026-08-14T07:25:00Z", null),
      snapshot("snap_010", "air-2026-08-13", 200, "2026-08-13T07:18:00Z", "2026-08-13T07:19:00Z"),
    ],
    columns: [
      column("observed_at", "string", hourly("2026-08-05T00:00:00Z")),
      column("temperature", "float64", (index) => 21 + ((index * 3) % 11)),
      column("humidity", "float64", (index) => 48 + ((index * 11) % 40)),
    ],
  },
  {
    table: { table_id: "tbl_003", logical_name: "population.kosis__population", current_snapshot_id: "snap_009", revision: 1 },
    snapshots: [snapshot("snap_009", "population-2026-08-13", 229, "2026-08-13T08:58:00Z", "2026-08-13T08:59:00Z")],
    columns: [
      column("region_code", "string", (index) => String(11000 + index * 10)),
      column("population", "int64", (index) => 40_000 + ((index * 7919) % 560_000)),
    ],
  },
  {
    table: { table_id: "tbl_004", logical_name: "transport.seoul__transport", current_snapshot_id: "snap_008", revision: 1 },
    snapshots: [snapshot("snap_008", "transport-2026-08-12", 540, "2026-08-12T04:08:00Z", "2026-08-12T04:09:00Z")],
    columns: [
      column("route_id", "string", (index) => `R${String(100 + (index % 45))}`),
      column("observed_at", "string", hourly("2026-08-01T00:00:00Z")),
      column("ridership", "int64", (index) => 120 + ((index * 37) % 900)),
    ],
  },
];

const BY_NAME = new Map(DEMO_TABLES.map((entry) => [entry.table.logical_name, entry] as const));

/**
 * `GET /warehouse/tables` in the demo, with each table's current snapshot summarised and
 * its dataset named, as a Builder since kpubdata-builder#841 lists them.
 */
export const MOCK_WAREHOUSE_TABLES: { tables: WarehouseTable[] } = {
  tables: DEMO_TABLES.map((entry) => {
    const current = entry.snapshots.find((item) => item.snapshot_id === entry.table.current_snapshot_id);
    return {
      ...entry.table,
      current_snapshot: current
        ? { snapshot_id: current.snapshot_id, row_count: current.row_count, committed_at: current.committed_at, coverage: current.coverage ?? null }
        : null,
      dataset_id: entry.table.logical_name.slice(0, entry.table.logical_name.lastIndexOf(".")),
    };
  }),
};

/** `GET /warehouse/tables/{name}` in the demo, by logical name. */
export const MOCK_WAREHOUSE_DETAILS: Record<string, WarehouseTableDetailResponse> = Object.fromEntries(
  DEMO_TABLES.map((entry) => [entry.table.logical_name, { ...entry.table, snapshots: entry.snapshots }]),
);

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw signal.reason ?? new DOMException("Aborted", "AbortError");
}

function notFound(name: string): ApiError {
  return new ApiError(404, i18n.t("sql.demoWarehouse.tableNotFound", { name }), { code: "table_not_found" });
}

/** What the demo cannot do without a Builder: said as an error, never faked as a result. */
function needsBuilder(): ApiError {
  const message = i18n.t("sql.demoWarehouse.needsBuilder");
  return new ApiError(501, message, { code: "demo", error: message });
}

function resolve(tableName: string, requested: string | undefined): { entry: DemoTable; snap: WarehouseSnapshot } {
  const entry = BY_NAME.get(tableName);
  if (!entry) throw notFound(tableName);
  const id = !requested || requested === "current" ? entry.table.current_snapshot_id : requested;
  const snap = entry.snapshots.find((item) => item.snapshot_id === id && item.state === "committed");
  if (!snap) throw new ApiError(404, i18n.t("sql.demoWarehouse.snapshotNotFound", { name: tableName }), { code: "snapshot_not_found" });
  return { entry, snap };
}

/**
 * One page of generated rows for `snap` of `entry`. The demo computes nothing, so a
 * filtered or sorted page is refused (`needsBuilder`) rather than answered with the
 * unfiltered rows, and a snapshot without a row count keeps its count unknown: the page
 * says `not_computed`, and since the demo cannot tell where the rows end it never claims
 * the last page (`has_more` stays true).
 */
export function demoRowsPage(entry: DemoTable, snap: WarehouseSnapshot, request: WarehouseRowsRequest): WarehouseRowsResponse {
  if ((request.filters?.length ?? 0) > 0 || (request.sort?.length ?? 0) > 0) throw needsBuilder();
  const total = snap.row_count;
  const offset = request.offset ?? 0;
  const pageSize = request.page_size ?? 50;
  const selected = request.columns ? entry.columns.filter((item) => request.columns!.includes(item.meta.name)) : entry.columns;
  // Without a row count the end is unknown: the page is full and the next one may exist.
  const end = total === null ? offset + pageSize : Math.min(total, offset + pageSize);
  const rows = [];
  for (let index = offset; index < end; index++) {
    rows.push(Object.fromEntries(selected.map((item) => [item.meta.name, item.value(index)])));
  }
  const exact = request.count !== "none" && total !== null;
  const hasMore = total === null || end < total;
  return {
    snapshot: { table_id: entry.table.table_id, logical_name: entry.table.logical_name, snapshot_id: snap.snapshot_id, revision: entry.table.revision },
    columns: selected.map((item) => item.meta.name),
    column_meta: selected.map((item) => item.meta),
    rows,
    order: [],
    page: { offset, page_size: pageSize, returned: rows.length, has_more: hasMore, next_offset: hasMore ? end : null },
    count: exact ? { status: "exact", value: total } : { status: "not_computed", value: null },
    execution_ms: 0,
    startup_ms: 0,
    engine_execution_ms: 0,
  };
}

/** `POST /warehouse/rows` in the demo: one page of the pinned snapshot's generated rows. */
export function mockWarehouseRows(request: WarehouseRowsRequest): WarehouseRowsResponse {
  const { entry, snap } = resolve(request.table, request.snapshot);
  return demoRowsPage(entry, snap, request);
}

type WarehouseMethods = Pick<
  typeof builderApi,
  | "listWarehouseTables"
  | "getWarehouseTable"
  | "getWarehouseTableProfile"
  | "warehouseRows"
  | "warehouseQuery"
  | "warehouseAggregate"
  | "createWarehouseExport"
  | "listWarehouseExports"
  | "deleteWarehouseExport"
  | "downloadWarehouseExport"
  | "listAnalyses"
  | "createAnalysis"
  | "runAnalysis"
  | "deleteAnalysis"
>;

export type WarehouseApi = WarehouseMethods;

/** The warehouse endpoints as the demo answers them. */
export const mockWarehouseApi: WarehouseApi = {
  listWarehouseTables: async (signal) => {
    throwIfAborted(signal);
    return MOCK_WAREHOUSE_TABLES;
  },
  getWarehouseTable: async (name, signal) => {
    throwIfAborted(signal);
    const detail = MOCK_WAREHOUSE_DETAILS[name];
    if (!detail) throw notFound(name);
    return detail;
  },
  warehouseRows: async (request, signal) => {
    throwIfAborted(signal);
    return mockWarehouseRows(request);
  },
  // Nothing is saved in the demo, so there is nothing to list.
  listAnalyses: async (signal) => {
    throwIfAborted(signal);
    return { analyses: [] };
  },
  listWarehouseExports: async (signal) => {
    throwIfAborted(signal);
    return { exports: [] };
  },
  // A profile is computed over every row of a snapshot; the demo computes nothing.
  getWarehouseTableProfile: async () => {
    throw needsBuilder();
  },
  warehouseQuery: async () => {
    throw needsBuilder();
  },
  warehouseAggregate: async () => {
    throw needsBuilder();
  },
  createWarehouseExport: async () => {
    throw needsBuilder();
  },
  deleteWarehouseExport: async () => {
    throw needsBuilder();
  },
  downloadWarehouseExport: async () => {
    throw needsBuilder();
  },
  createAnalysis: async () => {
    throw needsBuilder();
  },
  runAnalysis: async () => {
    throw needsBuilder();
  },
  deleteAnalysis: async () => {
    throw needsBuilder();
  },
};
