/**
 * Table Detail finds a dataset's tables whose source key has a dot (#602).
 *
 * A public-API source without an alias is keyed `<provider>.<dataset>`, so Builder names
 * its table `<dataset_id>.<provider>.<dataset>`. The detail must open such a table on its
 * current snapshot — as the Tables list already shows it — and read its rows, while a
 * table of another dataset whose id extends this one stays out.
 */
import { act, render, screen, within } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { mswServer } from "../vitest.setup";
import { DatasetDetailPage } from "@/pages/DatasetDetailPage";
import { API_BASE } from "@/shared/config/env";
import { useUIStore } from "@/shared/hooks/useUIStore";
import type { WarehouseTable } from "@/shared/lib/builderApi";

function renderDetail(initialEntry: string) {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route path="/tables/:datasetId" element={<DatasetDetailPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

const DATASET = {
  dataset_id: "air",
  title: "대기질",
  sources: [
    { provider: "datago", dataset: "air_quality", alias: "" },
    { provider: "datago", dataset: "stations", alias: "stations.v2" },
  ],
  latest_run_id: "run-1",
  status: "ok",
  updated_at: "2026-09-02T00:00:00Z",
  row_counts: {},
  total_row_count: 12,
  stages: {},
  quality: null,
  status_axes: { refresh: "succeeded", completeness: "complete", health: "healthy", access: "available", maturity: "beta" },
  run_count: 1,
};

const SUMMARY = { row_count: 12, committed_at: "2026-09-02T00:00:00Z", coverage: null };

const warehouseTable = (logical_name: string, dataset_id: string | null, snapshot_id: string): WarehouseTable => ({
  table_id: logical_name,
  logical_name,
  current_snapshot_id: snapshot_id,
  revision: 1,
  current_snapshot: { snapshot_id, ...SUMMARY },
  dataset_id,
});

let tables: WarehouseTable[];
let rowsRequests: Array<Record<string, unknown>>;

beforeEach(() => {
  vi.stubEnv("VITE_USE_REAL_BUILDER", "true");
  act(() => useUIStore.setState({ isAssistantDrawerOpen: false }));
  rowsRequests = [];
  tables = [
    warehouseTable("air.datago.air_quality", "air", "snap_air"),
    warehouseTable("air.stations.v2", "air", "snap_stations"),
    // Dataset `air.datago` — its name starts with `air.` too, but Builder says whose it is.
    warehouseTable("air.datago.other", "air.datago", "snap_other"),
  ];
  mswServer.use(
    http.get(`${API_BASE}/warehouse/tables`, () => HttpResponse.json({ tables })),
    http.get(`${API_BASE}/warehouse/tables/:name`, ({ params }) => {
      const table = tables.find((entry) => entry.logical_name === params.name);
      if (!table) return HttpResponse.json({ code: "table_not_found" }, { status: 404 });
      return HttpResponse.json({
        ...table,
        snapshots: [
          { snapshot_id: table.current_snapshot_id, run_id: "run-1", state: "committed", created_at: SUMMARY.committed_at, ...SUMMARY },
        ],
      });
    }),
    http.get(`${API_BASE}/datasets/air`, () => HttpResponse.json(DATASET)),
    http.get(`${API_BASE}/datasets/air/runs`, () =>
      HttpResponse.json({
        dataset_id: "air",
        runs: [{ run_id: "run-1", status: "ok", started_at: "2026-09-01T00:00:00Z", finished_at: null, spec_digest: null, created_by: null }],
      }),
    ),
    http.get(`${API_BASE}/builds/:run/quality`, ({ params }) =>
      HttpResponse.json({ run_id: params.run, availability: "available", evaluated_checks: 0, quality_results: {}, schema_drift: {} }),
    ),
    http.post(`${API_BASE}/warehouse/rows`, async ({ request }) => {
      const body = (await request.json()) as Record<string, unknown>;
      rowsRequests.push(body);
      const table = tables.find((entry) => entry.logical_name === body.table);
      return HttpResponse.json({
        snapshot: { table_id: body.table, logical_name: body.table, snapshot_id: table?.current_snapshot_id, revision: 1 },
        columns: ["station"],
        column_meta: [{ name: "station", logical_type: "string", wire_encoding: "string" }],
        rows: [{ station: `${String(body.table)}-row` }],
        order: [],
        page: { offset: 0, page_size: 50, returned: 1, has_more: false, next_offset: null },
        count: { status: "exact", value: 12 },
        execution_ms: 1,
        startup_ms: 0,
        engine_execution_ms: 1,
      });
    }),
  );
});
afterEach(() => vi.unstubAllEnvs());

describe("Table Detail with dotted source keys (#602)", () => {
  it("opens a source without an alias on its current snapshot and reads its rows", async () => {
    renderDetail("/tables/air?tab=preview&source=datago.air_quality");
    const preview = await screen.findByRole("tabpanel", { name: "미리보기" });
    await within(preview).findByText("air.datago.air_quality-row");

    expect(rowsRequests[0]).toMatchObject({ table: "air.datago.air_quality", snapshot: "snap_air" });
    // Both of the dataset's sources are offered, by their whole keys; the other dataset's table is not.
    expect(screen.getByRole("button", { name: "datago.air_quality" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "stations.v2" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /other/ })).not.toBeInTheDocument();
  });

  it("opens a dotted alias by its whole key", async () => {
    renderDetail("/tables/air?tab=preview&source=stations.v2");
    const preview = await screen.findByRole("tabpanel", { name: "미리보기" });
    await within(preview).findByText("air.stations.v2-row");
    expect(rowsRequests[0]).toMatchObject({ table: "air.stations.v2", snapshot: "snap_stations" });
  });

  it("does not attribute a table Builder could not attribute (dataset_id null)", async () => {
    // Its name reads as `air`'s, yet Builder did not say so: it is not guessed from the name.
    tables = [warehouseTable("air.air_quality", null, "snap_air")];
    renderDetail("/tables/air");
    expect(await screen.findByText("이 테이블에는 아직 커밋된 스냅샷이 없어 실행(run) 기준으로 보여 줍니다.")).toBeInTheDocument();
    expect(rowsRequests).toEqual([]);
  });
});
