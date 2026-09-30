/**
 * The demo speaks the contract and nothing more (#530).
 *
 * Every demo fixture is parsed with the zod schema of the endpoint it stands in for, and
 * the parsed value must equal the fixture. zod strips a key its schema does not model, so
 * a field Builder does not send (an institution, a licence, a column description) fails
 * here instead of shaping the product in the demo first.
 *
 * The demo also leads with tables and snapshots: in mock mode the warehouse is there, and
 * each table belongs to a demo dataset and each snapshot to one of its runs.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { z } from "zod";

import { fetchCatalog } from "@/features/add-data/api";
import { MOCK_DATASETS, MOCK_QUALITY, MOCK_QUALITY_HISTORY, MOCK_RUNS, MOCK_STAGES, mockDatasetDetail, mockStageDetail } from "@/features/datasets/api/mockData";
import { MOCK_WAREHOUSE_DETAILS, MOCK_WAREHOUSE_TABLES, mockWarehouseApi, mockWarehouseRows } from "@/features/datasets/api/mockWarehouse";
import { loadTableList, splitLogicalName } from "@/features/datasets/tableList";
import { loadCatalog } from "@/features/discover/api";
import { detectWarehouse } from "@/features/sql/warehouse";
import { API_BASE } from "@/shared/config/env";
import * as schemas from "@/shared/lib/builderApi.schema";
import { DEMO_DATASETS } from "@/shared/lib/demoDatasets";

beforeEach(() => vi.stubEnv("VITE_USE_REAL_BUILDER", "false"));
afterEach(() => vi.unstubAllEnvs());

/** Parses and demands nothing was stripped or coerced. */
function expectContract<T>(schema: z.ZodType<T>, value: unknown, label: string) {
  const parsed = schema.safeParse(value);
  expect(parsed.success, `${label}: ${parsed.success ? "" : parsed.error.message}`).toBe(true);
  expect(parsed.data, `${label}: carries a field the contract does not model`).toEqual(value);
}

/** Values the demo must not make up: institutions, licence terms. */
const INVENTED = /국토교통부|환경부|한국환경공단|식약처|식품의약품안전처|기상청|통계청|공공누리|KOGL|licen[cs]e/i;

describe("demo fixtures match the Builder contract (#530)", () => {
  it("datasets, runs, stages and quality", () => {
    expectContract(schemas.datasetsResponseSchema, MOCK_DATASETS, "GET /datasets");
    for (const dataset of MOCK_DATASETS.datasets) {
      expectContract(schemas.datasetDetailResponseSchema, mockDatasetDetail(dataset.dataset_id), `GET /datasets/${dataset.dataset_id}`);
    }
    for (const [id, runs] of Object.entries(MOCK_RUNS)) expectContract(schemas.datasetRunsResponseSchema, runs, `runs ${id}`);
    for (const [id, stages] of Object.entries(MOCK_STAGES)) {
      expectContract(schemas.runStagesResponseSchema, stages, `stages ${id}`);
      for (const source of stages.sources) {
        for (const stage of ["bronze", "silver", "gold"] as const) {
          expectContract(schemas.stageDetailResponseSchema, mockStageDetail(id, source.source_key, stage), `stage ${id}/${source.source_key}/${stage}`);
        }
      }
    }
    for (const [id, quality] of Object.entries(MOCK_QUALITY)) expectContract(schemas.buildQualityResponseSchema, quality, `quality ${id}`);
    for (const [id, history] of Object.entries(MOCK_QUALITY_HISTORY)) {
      expectContract(schemas.datasetQualityHistoryResponseSchema, history, `quality history ${id}`);
    }
  });

  it("the warehouse: tables, snapshots and row pages", () => {
    expectContract(schemas.warehouseTableListResponseSchema, MOCK_WAREHOUSE_TABLES, "GET /warehouse/tables");
    for (const table of MOCK_WAREHOUSE_TABLES.tables) {
      const detail = MOCK_WAREHOUSE_DETAILS[table.logical_name];
      expectContract(schemas.warehouseTableDetailResponseSchema, detail, `GET /warehouse/tables/${table.logical_name}`);
      const page = mockWarehouseRows({ table: table.logical_name, snapshot: "current", page_size: 5 });
      expectContract(schemas.warehouseRowsResponseSchema, page, `POST /warehouse/rows ${table.logical_name}`);
      // No label or description for a column the Builder did not describe.
      for (const column of page.column_meta) expect(column.display, `${table.logical_name}.${column.name}`).toBeUndefined();
    }
  });

  it("the catalog, in the demo and in the MSW Builder", async () => {
    expectContract(schemas.catalogResponseSchema, await loadCatalog(), "Catalog (discover)");
    expectContract(schemas.catalogResponseSchema, await fetchCatalog(), "Catalog (add data)");
    const response = await fetch(`${API_BASE}/catalog`);
    expectContract(schemas.catalogResponseSchema, await response.json(), "MSW GET /catalog");
  });

  it("makes up no institution name or licence term", async () => {
    const everything = JSON.stringify({
      MOCK_DATASETS,
      MOCK_RUNS,
      MOCK_STAGES,
      MOCK_QUALITY,
      MOCK_WAREHOUSE_DETAILS,
      DEMO_DATASETS,
      discover: await loadCatalog(),
      addData: await fetchCatalog(),
    });
    expect(everything.match(INVENTED)?.[0] ?? null).toBeNull();
  });
});

describe("the demo leads with tables and snapshots (#530)", () => {
  it("has a warehouse whose tables belong to demo datasets and whose snapshots come from their runs", async () => {
    const warehouse = await detectWarehouse();
    expect(warehouse.status).toBe("available");
    const datasets = new Set(MOCK_DATASETS.datasets.map((dataset) => dataset.dataset_id));
    for (const table of MOCK_WAREHOUSE_TABLES.tables) {
      const name = splitLogicalName(table.logical_name);
      expect(name && datasets.has(name.datasetId), table.logical_name).toBe(true);
      const runs = new Set(MOCK_RUNS[name!.datasetId].runs.map((run) => run.run_id));
      for (const snapshot of MOCK_WAREHOUSE_DETAILS[table.logical_name].snapshots) expect(runs.has(snapshot.run_id), snapshot.snapshot_id).toBe(true);
    }
  });

  it("lists each table with its current snapshot and row count", async () => {
    const list = await loadTableList();
    expect(list.warehouse).toBe(true);
    const air = list.rows.find((row) => row.dataset_id === "air-quality");
    expect(air?.snapshots?.map((entry) => [entry.sourceKey, entry.current?.snapshot_id, entry.current?.row_count])).toEqual([
      ["datago__air", "snap_012", 1000],
      ["kma__weather", "snap_010", 200],
    ]);
  });

  it("pages rows on one pinned snapshot and says what it cannot compute", async () => {
    const first = await mockWarehouseApi.warehouseRows({ table: "population.kosis__population", snapshot: "current", offset: 200, page_size: 50 });
    expect(first.snapshot.snapshot_id).toBe("snap_009");
    expect(first.page).toEqual({ offset: 200, page_size: 50, returned: 29, has_more: false, next_offset: null });
    expect(first.count).toEqual({ status: "exact", value: 229 });
    await expect(mockWarehouseApi.warehouseQuery({ table: "population.kosis__population", sql: "select 1" })).rejects.toMatchObject({ status: 501 });
  });
});
