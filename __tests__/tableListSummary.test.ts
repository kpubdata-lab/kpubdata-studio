/**
 * The Tables list reads each table's current snapshot from the `GET /warehouse/tables`
 * summary (kpubdata-builder#841, #569) and asks a table's detail only when an older
 * Builder omits it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MOCK_DATASETS } from "@/features/datasets/api/mockData";
import { loadTableList, tableOwner } from "@/features/datasets/tableList";
import { builderApi, type WarehouseTable } from "@/shared/lib/builderApi";

const SNAPSHOT = { snapshot_id: "snap_1", row_count: 10, committed_at: "2026-09-01T00:00:00Z", coverage: null };

beforeEach(() => {
  vi.stubEnv("VITE_USE_REAL_BUILDER", "true");
  vi.spyOn(builderApi, "listDatasets").mockResolvedValue(MOCK_DATASETS);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("Tables list from the warehouse table summary (kpubdata-builder#841)", () => {
  it("uses current_snapshot and dataset_id and asks no table detail", async () => {
    const tables: WarehouseTable[] = [
      { table_id: "t1", logical_name: "air-quality.datago__air", current_snapshot_id: "snap_1", revision: 1, current_snapshot: SNAPSHOT, dataset_id: "air-quality" },
      { table_id: "t2", logical_name: "population.kosis__population", current_snapshot_id: null, revision: 0, current_snapshot: null, dataset_id: "population" },
      // Builder could not read the dataset: not attributed to any row, never guessed from the name.
      { table_id: "t3", logical_name: "transport.seoul__transport", current_snapshot_id: "snap_3", revision: 1, current_snapshot: { ...SNAPSHOT, snapshot_id: "snap_3" }, dataset_id: null },
    ];
    vi.spyOn(builderApi, "listWarehouseTables").mockResolvedValue({ tables });
    const detail = vi.spyOn(builderApi, "getWarehouseTable");

    const list = await loadTableList();

    expect(detail).not.toHaveBeenCalled();
    const byId = Object.fromEntries(list.rows.map((row) => [row.dataset_id, row.snapshots]));
    expect(byId["air-quality"]).toEqual([{ logicalName: "air-quality.datago__air", sourceKey: "datago__air", current: SNAPSHOT }]);
    expect(byId.population).toEqual([{ logicalName: "population.kosis__population", sourceKey: "kosis__population", current: null }]);
    expect(byId.transport).toEqual([]);
  });

  it("falls back to one detail request per committed table on an older Builder", async () => {
    const tables: WarehouseTable[] = [
      { table_id: "t1", logical_name: "air-quality.datago__air", current_snapshot_id: "snap_1", revision: 1 },
      { table_id: "t2", logical_name: "population.kosis__population", current_snapshot_id: null, revision: 0 },
    ];
    vi.spyOn(builderApi, "listWarehouseTables").mockResolvedValue({ tables });
    const detail = vi.spyOn(builderApi, "getWarehouseTable").mockResolvedValue({
      ...tables[0],
      snapshots: [{ snapshot_id: "snap_1", run_id: "run-1", state: "committed", row_count: 10, created_at: "2026-09-01T00:00:00Z", committed_at: "2026-09-01T00:00:00Z", coverage: null }],
    });

    const list = await loadTableList();

    expect(detail).toHaveBeenCalledTimes(1);
    expect(detail.mock.calls[0][0]).toBe("air-quality.datago__air");
    const air = list.rows.find((row) => row.dataset_id === "air-quality");
    expect(air?.snapshots?.[0].current).toMatchObject({ snapshot_id: "snap_1", row_count: 10 });
  });

  it("keeps dotted source keys and matches an older Builder's tables by dataset prefix (#602)", async () => {
    const tables: WarehouseTable[] = [
      // Current Builder: a public-API source without an alias is keyed `<provider>.<dataset>`.
      { table_id: "t1", logical_name: "air-quality.datago.air_quality", current_snapshot_id: "snap_1", revision: 1, current_snapshot: SNAPSHOT, dataset_id: "air-quality" },
      // Older Builder: no dataset_id, no summary — the name's dataset prefix decides.
      { table_id: "t2", logical_name: "population.kosis.population", current_snapshot_id: null, revision: 0 },
      { table_id: "t3", logical_name: "elsewhere.kosis.population", current_snapshot_id: null, revision: 0 },
    ];
    vi.spyOn(builderApi, "listWarehouseTables").mockResolvedValue({ tables });

    const list = await loadTableList();

    const byId = Object.fromEntries(list.rows.map((row) => [row.dataset_id, row.snapshots]));
    expect(byId["air-quality"]).toEqual([{ logicalName: "air-quality.datago.air_quality", sourceKey: "datago.air_quality", current: SNAPSHOT }]);
    expect(byId.population).toEqual([{ logicalName: "population.kosis.population", sourceKey: "kosis.population", current: null }]);
    expect(byId.transport).toEqual([]);
  });

  it("tableOwner: Builder's dataset_id wins over splitting the name, which only an older Builder needs", () => {
    expect(tableOwner({ logical_name: "a.b.src", dataset_id: "a.b" })).toEqual({ datasetId: "a.b", sourceKey: "src" });
    expect(tableOwner({ logical_name: "a.b.src" })).toEqual({ datasetId: "a.b", sourceKey: "src" });
    expect(tableOwner({ logical_name: "a.src", dataset_id: null })).toBeNull();
  });
});
