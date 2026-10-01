/**
 * Table Detail opens on the current snapshot, with no run, source or stage to pick (#526).
 */
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { mswServer } from "../vitest.setup";
import { DatasetDetailPage } from "@/pages/DatasetDetailPage";
import { API_BASE } from "@/shared/config/env";
import { useUIStore } from "@/shared/hooks/useUIStore";
import { hideDemoWarehouse } from "./support/noWarehouse";

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location">{location.pathname}{location.search}</output>;
}

function renderDetail(initialEntry = "/tables/air") {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <LocationProbe />
      <Routes>
        <Route path="/tables/:datasetId" element={<DatasetDetailPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

const location = () => screen.getByTestId("location").textContent ?? "";

const DATASET = {
  dataset_id: "air",
  title: "대기질",
  sources: [{ provider: "data.go.kr", dataset: "air", alias: "서울 대기질" }],
  latest_run_id: "run-2",
  status: "ok",
  updated_at: "2026-09-02T00:00:00Z",
  row_counts: {},
  total_row_count: 999,
  stages: {},
  quality: null,
  status_axes: { refresh: "succeeded", completeness: "partial", health: "stale", access: "available", maturity: "beta" },
  run_count: 2,
};

const TABLES = [
  { table_id: "t1", logical_name: "air.datago", current_snapshot_id: "snap_2", revision: 2 },
  { table_id: "t2", logical_name: "air.kma", current_snapshot_id: "snap_k", revision: 1 },
  { table_id: "t3", logical_name: "other.x", current_snapshot_id: "snap_x", revision: 1 },
  { table_id: "t4", logical_name: "fresh.y", current_snapshot_id: null, revision: 0 },
];

const snapshot = (snapshot_id: string, run_id: string, row_count: number | null, coverage: unknown = null) => ({
  snapshot_id,
  run_id,
  state: "committed",
  row_count,
  created_at: "2026-09-01T00:00:00Z",
  committed_at: "2026-09-01T00:00:00Z",
  coverage,
});

const SNAPSHOTS: Record<string, unknown[]> = {
  "air.datago": [
    snapshot("snap_2", "run-2", 1234, {
      status: "partial",
      reasons: ["page_limit"],
      fetched_row_count: 1234,
      source_reported_total: { status: "reported", value: 1500, observed_at: "2026-09-01T00:00:00Z" },
    }),
    snapshot("snap_1", "run-1", null),
  ],
  "air.kma": [snapshot("snap_k", "run-k", 10)],
};

let requests: string[];
let rowsRequests: Array<Record<string, unknown>>;

beforeEach(() => {
  vi.stubEnv("VITE_USE_REAL_BUILDER", "true");
  act(() => useUIStore.setState({ isAssistantDrawerOpen: false }));
  requests = [];
  rowsRequests = [];
  mswServer.use(
    http.get(`${API_BASE}/warehouse/tables`, () => HttpResponse.json({ tables: TABLES })),
    http.get(`${API_BASE}/warehouse/tables/:name`, ({ params }) => {
      const name = String(params.name);
      requests.push(`table ${name}`);
      const table = TABLES.find((item) => item.logical_name === name)!;
      return HttpResponse.json({ ...table, snapshots: SNAPSHOTS[name] ?? [] });
    }),
    http.get(`${API_BASE}/datasets/air`, () => HttpResponse.json(DATASET)),
    http.get(`${API_BASE}/datasets/air/runs`, () =>
      HttpResponse.json({
        dataset_id: "air",
        runs: [
          { run_id: "run-3", status: "failed", started_at: "2026-09-03T00:00:00Z", finished_at: null, spec_digest: null, created_by: null },
          { run_id: "run-2", status: "ok", started_at: "2026-09-01T00:00:00Z", finished_at: null, spec_digest: null, created_by: null },
        ],
      }),
    ),
    http.get(`${API_BASE}/builds/:run/quality`, ({ params }) => {
      requests.push(`quality ${String(params.run)}`);
      return HttpResponse.json({
        run_id: params.run,
        availability: "available",
        evaluated_checks: 1,
        quality_results: {
          datago: [{ source_key: "datago", category: "completeness", rule: "not_null", column: "pm10", status: "warn", actual: 3, threshold: 0, affected_rows: 3, evaluated_rows: 1234, detail: null }],
        },
        schema_drift: {},
      });
    }),
    http.post(`${API_BASE}/warehouse/rows`, async ({ request }) => {
      const body = (await request.json()) as Record<string, unknown>;
      rowsRequests.push(body);
      return HttpResponse.json({
        snapshot: { table_id: "t1", logical_name: body.table, snapshot_id: body.snapshot, revision: 2 },
        columns: ["region_code", "pm10"],
        column_meta: [
          { name: "region_code", logical_type: "string", wire_encoding: "string" },
          {
            name: "pm10",
            logical_type: "float64",
            wire_encoding: "number",
            display: { label: "미세먼지", origin: "builder" },
            unit: { name: "µg/m³", origin: "builder" },
          },
        ],
        rows: [{ region_code: "01100", pm10: 12.5 }],
        order: [],
        page: { offset: 0, page_size: 50, returned: 1, has_more: false, next_offset: null },
        count: { status: "exact", value: 1 },
        execution_ms: 1,
        startup_ms: 0,
        engine_execution_ms: 1,
      });
    }),
  );
});
afterEach(() => vi.unstubAllEnvs());

describe("Table Detail on a warehouse (#526)", () => {
  it("opens on the current snapshot with no run, source or stage picker", async () => {
    renderDetail();
    expect(await screen.findByRole("heading", { level: 1, name: "대기질" })).toBeInTheDocument();
    await screen.findByText("snap_2");

    expect(screen.queryByLabelText("Run 선택")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Source 선택")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Stage 선택")).not.toBeInTheDocument();
    expect(screen.queryAllByRole("combobox")).toHaveLength(0);
    expect(screen.queryByRole("link", { name: "이 Run 게시" })).not.toBeInTheDocument();

    expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual(["개요", "스키마", "프로파일", "미리보기", "품질", "스냅샷"]);

    // Header: identifier, provider, what needs action, and the three actions.
    expect(screen.getByText("air.datago")).toHaveClass("font-mono");
    const attention = screen.getByRole("list", { name: "조치가 필요한 상태" });
    expect(within(attention).getAllByRole("listitem").map((item) => item.textContent)).toEqual(["상태오래됨", "완전성부분"]);
    expect(screen.getByRole("button", { name: "이 테이블에 대해 묻기" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "갱신" })).toHaveAttribute("href", "/refresh-jobs/run-2/edit");
    expect(screen.getByRole("link", { name: "쿼리" })).toHaveAttribute("href", "/sql?table=air.datago");

    // Overview: the snapshot, its rows, its coverage from WarehouseSnapshot.coverage, and the run as provenance.
    const panel = screen.getByRole("tabpanel");
    expect(panel).toHaveTextContent("1,234");
    expect(panel).toHaveTextContent("rev 2");
    const coverage = within(panel).getAllByText("수집 범위").find((element) => element.tagName === "DT")!.nextElementSibling as HTMLElement;
    expect(within(coverage).getByText("부분").closest("[data-status]")).toHaveAttribute("data-status", "actionable");
    expect(panel).toHaveTextContent("받은 1234행 / 보고 1500행.");
    expect(within(panel).getByRole("link", { name: "run-2" })).toHaveAttribute("href", "/refresh-jobs/run-2");
    // The run total is not the snapshot's row count.
    expect(panel).not.toHaveTextContent("999");
  });

  it("shows the current snapshot's schema, preview and quality without choosing anything", async () => {
    renderDetail("/tables/air?tab=schema");
    const schema = await screen.findByRole("tabpanel", { name: "스키마" });
    await within(schema).findByText("region_code");
    expect(rowsRequests[0]).toEqual({ table: "air.datago", snapshot: "snap_2", page_size: 1, count: "none" });
    const pm10 = within(schema).getByText("pm10").closest("tr")!;
    expect(pm10).toHaveTextContent("float64미세먼지µg/m³");
    const region = within(schema).getByText("region_code").closest("tr")!;
    expect(region.querySelectorAll('[data-status="missing"]')).toHaveLength(2);

    fireEvent.click(screen.getByRole("tab", { name: "미리보기" }));
    const preview = await screen.findByRole("tabpanel", { name: "미리보기" });
    await within(preview).findByText("01100");
    expect(rowsRequests.at(-1)).toMatchObject({ table: "air.datago", snapshot: "snap_2", offset: 0 });

    fireEvent.click(screen.getByRole("tab", { name: "품질" }));
    await within(await screen.findByRole("tabpanel", { name: "품질" })).findByText(/not_null/);
    expect(requests).toContain("quality run-2");
  });

  it("chooses a past snapshot only in the Snapshots tab, and keeps its run in view", async () => {
    renderDetail("/tables/air?tab=snapshots");
    const panel = await screen.findByRole("tabpanel", { name: "스냅샷" });
    const current = (await within(panel).findByText("snap_2")).closest("tr")!;
    expect(current).toHaveTextContent("현재");
    const past = within(panel).getByText("snap_1").closest("tr")!;
    expect(within(past).getByText("run-1")).toHaveClass("font-mono");
    expect(within(past).getByRole("link", { name: "이 Run 게시" })).toHaveAttribute("href", "/refresh-jobs/run-1/publish?dataset=air");
    expect(within(past).getByRole("link", { name: "스펙 편집·갱신" })).toHaveAttribute("href", "/refresh-jobs/run-1/edit");

    // Runs stay as provenance under the snapshots, including one that produced none.
    expect(await within(panel).findByText("run-3")).toBeInTheDocument();

    fireEvent.click(within(past).getByRole("button", { name: "보기" }));
    await waitFor(() => expect(location()).toBe("/tables/air?snapshot=snap_1"));
    expect(screen.getByText(/과거 스냅샷을 보고 있습니다/).closest("[role=status]")).toHaveTextContent("과거 스냅샷을 보고 있습니다: snap_1");
    const overview = screen.getByRole("tabpanel", { name: "개요" });
    expect(within(overview).getByRole("link", { name: "run-1" })).toBeInTheDocument();
    // The revision belongs to the current snapshot; a past one's is not in the contract.
    expect(within(overview).getAllByText((_, element) => element?.getAttribute("data-status") === "missing").length).toBeGreaterThan(0);
    expect(screen.getByRole("link", { name: "쿼리" })).toHaveAttribute("href", "/sql?table=air.datago&snapshot=snap_1");

    fireEvent.click(screen.getByRole("button", { name: "현재 스냅샷으로" }));
    await waitFor(() => expect(location()).toBe("/tables/air"));
  });

  it("switches source tables without a select, one warehouse table per source", async () => {
    renderDetail();
    await screen.findByText("snap_2");
    const kma = screen.getByRole("button", { name: "kma" });
    expect(screen.getByRole("button", { name: "datago" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(kma);
    await screen.findByText("snap_k");
    expect(location()).toBe("/tables/air?source=kma");
    expect(requests).toContain("table air.kma");
    expect(requests).not.toContain("table other.x");
  });

  it("says so when a linked snapshot is not in the table", async () => {
    renderDetail("/tables/air?snapshot=snap_gone");
    expect(await screen.findByRole("alert")).toHaveTextContent("스냅샷 snap_gone 을 이 테이블에서 찾을 수 없습니다.");
  });

  it("writes the snapshot's run and source for Ask KPubData, never a guessed stage", async () => {
    renderDetail("/tables/air?stage=gold");
    await screen.findByText("snap_2");
    fireEvent.click(screen.getByRole("button", { name: "이 테이블에 대해 묻기" }));
    await waitFor(() => expect(location()).toBe("/tables/air?run=run-2&source=datago"));
    expect(useUIStore.getState().isAssistantDrawerOpen).toBe(true);
  });
});

describe("Table Detail without a snapshot to open on (#526)", () => {
  it("keeps the run view and says in one line that there is no warehouse", async () => {
    vi.stubEnv("VITE_USE_REAL_BUILDER", "false");
    hideDemoWarehouse();
    renderDetail("/tables/air-quality");
    expect(await screen.findByText("이 배포에는 warehouse 가 없어 실행(run) 기준으로 보여 줍니다.")).toBeInTheDocument();
    expect(screen.getByLabelText("Run 선택")).toBeInTheDocument();
  });

  it("keeps the run view when the warehouse has nothing committed for the table", async () => {
    mswServer.use(
      http.get(`${API_BASE}/datasets/fresh`, () => HttpResponse.json({ ...DATASET, dataset_id: "fresh", title: "새 테이블" })),
      http.get(`${API_BASE}/datasets/fresh/runs`, () => HttpResponse.json({ dataset_id: "fresh", runs: [] })),
    );
    renderDetail("/tables/fresh");
    expect(await screen.findByText("이 테이블에는 아직 커밋된 스냅샷이 없어 실행(run) 기준으로 보여 줍니다.")).toBeInTheDocument();
    expect(requests.filter((request) => request.startsWith("table "))).toEqual([]);
  });
});
