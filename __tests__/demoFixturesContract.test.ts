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
import * as mockDataModule from "@/features/datasets/api/mockData";
import { MOCK_DATASETS, MOCK_QUALITY, MOCK_QUALITY_HISTORY, MOCK_RUNS, MOCK_STAGES, mockDatasetDetail, mockStageDetail } from "@/features/datasets/api/mockData";
import * as mockWarehouseModule from "@/features/datasets/api/mockWarehouse";
import {
  demoRowsPage,
  type DemoTable,
  MOCK_WAREHOUSE_DETAILS,
  MOCK_WAREHOUSE_TABLES,
  mockWarehouseApi,
  mockWarehouseRows,
} from "@/features/datasets/api/mockWarehouse";
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

/**
 * Values the demo must not make up: institutions and licence terms. Named ones are listed,
 * and any other institution is caught by how Korean public bodies are named — a ministry
 * (부), agency (청, 처), corporation (공사, 공단), institute (…원), commission (위원회) or a
 * metropolitan city or province (특별시, 광역시, 경기도, …).
 */
const INVENTED = new RegExp(
  [
    "국토교통부|환경부|한국환경공단|식약처|식품의약품안전처|기상청|통계청|공공누리|KOGL|licen[cs]e",
    "[가-힣]{2,}(?:부|청|처|공사|공단|위원회|재단|(?:진흥|연구|평가|관리|정보)원)(?![가-힣])",
    "[가-힣]*(?:특별시|광역시|특별자치시|특별자치도)",
    "(?:경기|강원|충청북|충청남|충북|충남|전라북|전라남|전북|전남|경상북|경상남|경북|경남|제주)도(?![가-힣])",
  ].join("|"),
  "i",
);

/** The first made-up institution or licence term in `text`, or null. */
function firstInvented(text: string): string | null {
  return text.match(INVENTED)?.[0] ?? null;
}

/** Every exported `MOCK_*` fixture of a module, so a new one is scanned without being listed here. */
function mockFixtures(module: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(module).filter(([name]) => name.startsWith("MOCK_")));
}

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
    const fixtures = { ...mockFixtures(mockDataModule), ...mockFixtures(mockWarehouseModule) };
    // The scan collects every exported fixture, including the ones #591 found missing.
    expect(Object.keys(fixtures)).toEqual(expect.arrayContaining(["MOCK_QUALITY_HISTORY", "MOCK_WAREHOUSE_TABLES", "MOCK_WAREHOUSE_DETAILS", "MOCK_DATASETS"]));
    const everything = JSON.stringify({
      fixtures,
      details: MOCK_DATASETS.datasets.map((dataset) => mockDatasetDetail(dataset.dataset_id)),
      rows: MOCK_WAREHOUSE_TABLES.tables.map((table) => mockWarehouseRows({ table: table.logical_name, snapshot: "current", page_size: 5 })),
      DEMO_DATASETS,
      discover: await loadCatalog(),
      addData: await fetchCatalog(),
    });
    expect(firstInvented(everything)).toBeNull();
  });
});

describe("the fixture gates fail when they should (#591)", () => {
  it("expectContract rejects a field the contract does not model", () => {
    expectContract(schemas.datasetsResponseSchema, MOCK_DATASETS, "baseline");
    const extra = { ...MOCK_DATASETS, datasets: MOCK_DATASETS.datasets.map((dataset) => ({ ...dataset, institution: "demo" })) };
    expect(() => expectContract(schemas.datasetsResponseSchema, extra, "extra field")).toThrow(/does not model/);
    expect(() => expectContract(schemas.datasetsResponseSchema, { datasets: "none" }, "wrong type")).toThrow();
  });

  it("catches an institution name that is not on the named list", () => {
    for (const name of ["서울특별시", "부산광역시", "경기도", "한국도로공사", "국민건강보험공단", "산림청", "조달청", "행정안전부", "개인정보보호위원회", "건강보험심사평가원"]) {
      expect(firstInvented(JSON.stringify({ ...MOCK_WAREHOUSE_TABLES, provider: name })), name).toBe(name);
    }
    // Place names and plain words the demo does use stay allowed.
    expect(firstInvented("서울 종로구 따릉이 대중교통 행정구역별 인구총조사 측정망 품목기준코드")).toBeNull();
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

  it("refuses a filtered or sorted page instead of answering it unfiltered (#591)", async () => {
    const table = "population.kosis__population";
    await expect(
      mockWarehouseApi.warehouseRows({ table, snapshot: "current", filters: [{ column: "region_code", op: "eq", value: "11000" }] }),
    ).rejects.toMatchObject({ status: 501, details: { code: "demo" } });
    await expect(mockWarehouseApi.warehouseRows({ table, snapshot: "current", sort: [{ column: "population", direction: "desc" }] })).rejects.toMatchObject({
      status: 501,
      details: { code: "demo" },
    });
    // An empty filter or sort list asks for nothing the demo cannot do.
    const plain = await mockWarehouseApi.warehouseRows({ table, snapshot: "current", filters: [], sort: [], page_size: 5 });
    expect(plain.count).toEqual({ status: "exact", value: 229 });
  });

  it("keeps a missing row count unknown instead of reading it as 0 (#591)", () => {
    const table = MOCK_WAREHOUSE_DETAILS["population.kosis__population"];
    const snap = { ...table.snapshots[0], row_count: null };
    const entry: DemoTable = {
      table: { table_id: table.table_id, logical_name: table.logical_name, current_snapshot_id: snap.snapshot_id, revision: table.revision },
      snapshots: [snap],
      columns: [{ meta: { name: "region_code", logical_type: "string", wire_encoding: "string" }, value: (index) => String(index) }],
    };
    const page = demoRowsPage(entry, snap, { table: table.logical_name, snapshot: "current", page_size: 5, count: "exact" });
    expect(page.count).toEqual({ status: "not_computed", value: null });
    // The demo cannot tell where the rows end, so it never claims the last page.
    expect(page.page).toMatchObject({ has_more: true, next_offset: 5 });
    expectContract(schemas.warehouseRowsResponseSchema, page, "rows with no row count");
  });
});
