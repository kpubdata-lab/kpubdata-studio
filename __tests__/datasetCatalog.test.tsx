import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { mswServer } from "../vitest.setup";
import { DatasetCatalogPage } from "@/pages/DatasetCatalogPage";
import { API_BASE } from "@/shared/config/env";
import { hideDemoWarehouse } from "./support/noWarehouse";

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location">{location.pathname}{location.search}</output>;
}

function renderCatalog(initialEntry = "/tables") {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <LocationProbe />
      <Routes>
        <Route path="/tables" element={<DatasetCatalogPage />} />
        <Route path="/tables/:datasetId" element={<p>dataset detail destination</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

const headers = () => screen.getAllByRole("columnheader").map((cell) => cell.textContent);

afterEach(() => vi.unstubAllEnvs());

describe("Tables without a warehouse (mock deployment)", () => {
  beforeEach(() => {
    vi.stubEnv("VITE_USE_REAL_BUILDER", "false");
    hideDemoWarehouse();
  });

  it("searches table/provider and preserves q in the URL", async () => {
    renderCatalog();
    await screen.findByText("air-quality");
    fireEvent.change(screen.getByLabelText("테이블 / 제공자 검색"), { target: { value: "population" } });
    expect(screen.getByText("population")).toBeInTheDocument();
    expect(screen.queryByText("air-quality")).not.toBeInTheDocument();
    expect(screen.getByTestId("location")).toHaveTextContent("?q=population");
  });

  it("filters by any provider in a multi-source table", async () => {
    renderCatalog();
    await screen.findByText("air-quality");
    fireEvent.change(screen.getByLabelText("제공자"), { target: { value: "kma" } });
    expect(screen.getByText("air-quality")).toBeInTheDocument();
    expect(screen.queryByText("population")).not.toBeInTheDocument();
  });

  it("offers Create Table as the Tables page's own action (#423)", async () => {
    renderCatalog();
    expect(await screen.findByRole("link", { name: "테이블 만들기" })).toHaveAttribute("href", "/add");
  });

  it("lists status axes instead of stage and validation, hides the snapshot columns and says why (#525)", async () => {
    renderCatalog();
    await screen.findByText("air-quality");
    expect(headers()).toEqual(["테이블", "상태", "완전성", "갱신", "마지막 갱신"]);
    expect(screen.getByText(/이 배포에는 warehouse 가 없어/)).toBeInTheDocument();
    expect(screen.getAllByRole("combobox").map((select) => select.getAttribute("aria-label"))).toEqual(["제공자"]);
    expect(screen.queryByLabelText("Validation")).not.toBeInTheDocument();
  });

  it("badges only what needs action; a healthy value is plain text (#524, #525)", async () => {
    renderCatalog();
    const air = await screen.findByRole("link", { name: "대기질 통합 데이터 상세 열기" });
    const isBadge = (_: string, element: Element | null) => element?.getAttribute("data-status") === "actionable";
    const [nameCell, ...axisCells] = within(air).getAllByRole("cell");
    const airBadges = axisCells.flatMap((cell) => within(cell).queryAllByText(isBadge));
    expect(airBadges.map((badge) => badge.textContent)).toEqual(["완전성부분", "갱신실패"]);
    // The same badges under the name are what a narrow screen shows once the axis columns
    // are hidden (#573); CSS picks one set per width, which jsdom does not apply.
    expect(within(nameCell).getAllByText(isBadge).map((badge) => badge.textContent)).toEqual(["완전성부분", "갱신실패"]);

    const population = screen.getByRole("link", { name: "행정구역별 인구 상세 열기" });
    expect(within(population).queryAllByText(isBadge)).toHaveLength(0);
    expect(within(population).getByText("성공")).toHaveAttribute("data-status", "normal");
    expect(within(population).getAllByText("알 수 없음")[0]).toHaveAttribute("data-status", "unknown");
  });

  it("narrows to tables that need attention, and keeps that in the URL", async () => {
    renderCatalog();
    await screen.findByText("air-quality");
    fireEvent.click(screen.getByRole("checkbox", { name: "조치 필요만" }));
    expect(screen.getByTestId("location")).toHaveTextContent("?attention=1");
    expect(screen.getByText("air-quality")).toBeInTheDocument();
    expect(screen.queryByText("population")).not.toBeInTheDocument();
  });

  it("opens Table Detail on click and from the keyboard", async () => {
    renderCatalog();
    const row = await screen.findByRole("link", { name: "대기질 통합 데이터 상세 열기" });
    row.focus();
    fireEvent.keyDown(row, { key: "Enter" });
    await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent("/tables/air-quality"));
    expect(screen.getByText("dataset detail destination")).toBeInTheDocument();
  });
});

describe("Tables with a warehouse (#525)", () => {
  const dataset = (dataset_id: string, title: string) => ({
    dataset_id,
    title,
    sources: [{ provider: "data.go.kr", dataset: "x", alias: "x" }],
    latest_run_id: `${dataset_id}-run`,
    status: "ok",
    updated_at: "2026-08-01T00:00:00Z",
    row_counts: {},
    total_row_count: 999,
    stages: {},
    quality: null,
    status_axes: { refresh: "succeeded", completeness: "complete", health: "stale", access: "application_required", maturity: "beta" },
  });
  const snapshot = (snapshot_id: string, row_count: number | null) => ({
    snapshot_id,
    run_id: "r1",
    state: "committed",
    row_count,
    created_at: "2026-09-01T00:00:00Z",
    committed_at: "2026-09-01T00:00:00Z",
    coverage: null,
  });
  const TABLES = [
    { table_id: "t1", logical_name: "air.datago", current_snapshot_id: "snap_7", revision: 7 },
    { table_id: "t2", logical_name: "multi.a", current_snapshot_id: "snap_a", revision: 1 },
    { table_id: "t3", logical_name: "multi.b", current_snapshot_id: null, revision: 0 },
    { table_id: "t4", logical_name: "broken.x", current_snapshot_id: "snap_x", revision: 1 },
    { table_id: "t5", logical_name: "someone_else.y", current_snapshot_id: "snap_y", revision: 1 },
  ];
  let detailRequests: string[];

  beforeEach(() => {
    vi.stubEnv("VITE_USE_REAL_BUILDER", "true");
    detailRequests = [];
    mswServer.use(
      http.get(`${API_BASE}/datasets`, () =>
        HttpResponse.json({
          datasets: [dataset("air", "대기"), dataset("multi", "여러 소스"), dataset("broken", "상세 실패"), dataset("fresh", "아직 없음")],
        }),
      ),
      http.get(`${API_BASE}/warehouse/tables`, () => HttpResponse.json({ tables: TABLES })),
      http.get(`${API_BASE}/warehouse/tables/:name`, ({ params }) => {
        const name = String(params.name);
        detailRequests.push(name);
        if (name === "broken.x") return HttpResponse.json({ code: "not_found", message: "gone" }, { status: 404 });
        const table = TABLES.find((item) => item.logical_name === name)!;
        const rows = name === "air.datago" ? 1234 : null;
        return HttpResponse.json({ ...table, snapshots: [snapshot(table.current_snapshot_id!, rows), snapshot("snap_old", 1)] });
      }),
    );
  });

  it("shows the current snapshot, its rows and commit time, and `—` for anything Builder did not send", async () => {
    renderCatalog();
    const air = await screen.findByRole("link", { name: "대기 상세 열기" });
    expect(headers()).toEqual(["테이블", "현재 스냅샷", "행", "상태", "완전성", "갱신", "마지막 갱신"]);
    expect(screen.queryByText(/이 배포에는 warehouse 가 없어/)).not.toBeInTheDocument();

    const airCells = within(air).getAllByRole("cell");
    expect(airCells[1]).toHaveTextContent("snap_7");
    expect(airCells[2]).toHaveTextContent("1,234");
    // The run total (999) is not a snapshot's row count and never stands in for one.
    expect(air).not.toHaveTextContent("999");

    // Several sources: one line each, never summed; a table not committed yet says so.
    const multi = screen.getByRole("link", { name: "여러 소스 상세 열기" });
    const multiCells = within(multi).getAllByRole("cell");
    expect(multiCells[1]).toHaveTextContent("asnap_a");
    expect(multiCells[1]).toHaveTextContent("b커밋 전");
    expect(within(multiCells[2]).getAllByText((_, element) => element?.getAttribute("data-status") === "missing")).toHaveLength(2);

    // A failed detail request and a dataset with no warehouse table are unknown, not empty.
    for (const name of ["상세 실패 상세 열기", "아직 없음 상세 열기"]) {
      const cells = within(screen.getByRole("link", { name })).getAllByRole("cell");
      expect(cells[1].querySelector('[data-status="missing"]')).not.toBeNull();
      expect(cells[2].querySelector('[data-status="missing"]')).not.toBeNull();
    }

    // Only the listed datasets' committed tables are asked for.
    expect(detailRequests.sort()).toEqual(["air.datago", "broken.x", "multi.a"]);
  });

  it("puts an Access problem under the table name, as an axis-and-word badge", async () => {
    renderCatalog();
    const air = await screen.findByRole("link", { name: "대기 상세 열기" });
    const tableCell = within(air).getAllByRole("cell")[0];
    expect(within(tableCell).getByText("활용신청 필요").closest("[data-status]")).toHaveAttribute("data-status", "actionable");
    expect(tableCell).toHaveTextContent("접근");
  });
});

describe("an empty Tables list is not a search with no match (#666)", () => {
  it("says no table exists yet and links to Create Table from inside the empty card", async () => {
    vi.stubEnv("VITE_USE_REAL_BUILDER", "true");
    mswServer.use(
      http.get(`${API_BASE}/datasets`, () => HttpResponse.json({ datasets: [], total: 0 })),
      http.get(`${API_BASE}/warehouse/tables`, () => HttpResponse.json({ tables: [] })),
    );
    renderCatalog();

    const title = await screen.findByText("아직 만든 테이블이 없습니다");
    const card = title.parentElement as HTMLElement;
    expect(within(card).getByRole("link", { name: "테이블 만들기" })).toHaveAttribute("href", "/add");
    expect(screen.queryByText("조건에 맞는 테이블이 없습니다")).not.toBeInTheDocument();
    expect(screen.queryByText("검색어나 필터를 변경해 보세요.")).not.toBeInTheDocument();
  });

  it("keeps the no-match message when tables exist but the search hides them all", async () => {
    vi.stubEnv("VITE_USE_REAL_BUILDER", "false");
    hideDemoWarehouse();
    renderCatalog("/tables?q=no-such-table");

    expect(await screen.findByText("조건에 맞는 테이블이 없습니다")).toBeInTheDocument();
    expect(screen.getByText("검색어나 필터를 변경해 보세요.")).toBeInTheDocument();
    expect(screen.queryByText("아직 만든 테이블이 없습니다")).not.toBeInTheDocument();
  });
});
