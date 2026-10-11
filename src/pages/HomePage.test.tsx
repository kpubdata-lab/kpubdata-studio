/**
 * Home leads with tables that need attention and recent snapshots (#527).
 *
 * Real-Builder mode with msw: the attention list comes from `status_axes`, recent
 * snapshots from each warehouse table's current snapshot, recent analyses from
 * `GET /analyses`, and connection problems from the Access axis. No KPI aggregate is
 * requested any more.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { http, HttpResponse } from "msw";
import { mswServer } from "../../vitest.setup";
import { API_BASE } from "@/shared/config/env";
import { HomePage } from "./HomePage";

const axes = (overrides: Record<string, string> = {}) => ({
  refresh: "succeeded",
  completeness: "complete",
  health: "healthy",
  access: "available",
  maturity: "beta",
  ...overrides,
});

const dataset = (dataset_id: string, title: string, statusAxes: Record<string, string>, provider = "data.go.kr") => ({
  dataset_id,
  title,
  sources: [{ provider, dataset: dataset_id, alias: dataset_id }],
  latest_run_id: `${dataset_id}-run`,
  status: "ok",
  updated_at: "2026-09-01T00:00:00Z",
  row_counts: {},
  total_row_count: 1,
  stages: {},
  quality: null,
  status_axes: statusAxes,
});

const DATASETS = [
  dataset("air", "대기질", axes({ health: "stale" })),
  dataset("water", "수질", axes({ completeness: "partial", access: "application_required" })),
  dataset("rain", "강수", axes({ access: "application_required" })),
  dataset("fine", "정상 테이블", axes()),
  dataset("stopped", "취소된 갱신", axes({ refresh: "cancelled", health: "unknown" })),
];

const TABLES = [
  { table_id: "t1", logical_name: "air.datago", current_snapshot_id: "snap_a", revision: 1 },
  { table_id: "t2", logical_name: "water.kma", current_snapshot_id: "snap_w", revision: 1 },
  { table_id: "t3", logical_name: "broken.x", current_snapshot_id: "snap_b", revision: 1 },
  { table_id: "t4", logical_name: "fresh.y", current_snapshot_id: null, revision: 0 },
];

const COMMITTED: Record<string, string> = { "air.datago": "2026-09-01T00:00:00Z", "water.kma": "2026-09-03T00:00:00Z" };

let requested: string[];

function handlers({ warehouse = true, datasets = DATASETS, builds = [{ run_id: "r1", status: "ok", started_at: "2026-09-01T00:00:00Z", finished_at: null }] } = {}) {
  mswServer.use(
    http.get(`${API_BASE}/datasets`, () => HttpResponse.json({ datasets, total: datasets.length })),
    http.get(`${API_BASE}/builds`, () => HttpResponse.json({ builds })),
    http.get(`${API_BASE}/warehouse/tables`, () =>
      warehouse ? HttpResponse.json({ tables: TABLES }) : HttpResponse.json({ code: "warehouse_not_configured", message: "none" }, { status: 404 }),
    ),
    http.get(`${API_BASE}/warehouse/tables/:name`, ({ params }) => {
      const name = String(params.name);
      if (name === "broken.x") return HttpResponse.json({ code: "not_found", message: "gone" }, { status: 404 });
      const table = TABLES.find((item) => item.logical_name === name)!;
      return HttpResponse.json({
        ...table,
        snapshots: [
          {
            snapshot_id: table.current_snapshot_id,
            run_id: `${name}-run`,
            state: "committed",
            row_count: name === "air.datago" ? 1234 : null,
            created_at: COMMITTED[name],
            committed_at: COMMITTED[name],
            coverage: null,
          },
        ],
      });
    }),
    http.get(`${API_BASE}/analyses`, () =>
      HttpResponse.json({
        analyses: [
          {
            analysis_id: "a1",
            name: "월별 PM10",
            sql: "SELECT 1",
            limit: 100,
            bindings: [{ table: "air.datago", snapshot_id: "snap_a" }],
            result_meta: { columns: [], column_meta: [], row_count: 0, truncated: false, executed_at: "2026-09-01T00:00:00Z" },
            created_at: "2026-09-01T00:00:00Z",
          },
        ],
      }),
    ),
    http.get(`${API_BASE}/monitoring/:kind`, ({ request }) => {
      requested.push(new URL(request.url).pathname);
      return HttpResponse.json({}, { status: 500 });
    }),
    http.get(`${API_BASE}/quality/summary`, ({ request }) => {
      requested.push(new URL(request.url).pathname);
      return HttpResponse.json({}, { status: 500 });
    }),
  );
}

const renderHome = () =>
  render(
    <MemoryRouter>
      <HomePage />
    </MemoryRouter>,
  );

const section = (name: string) => screen.getByRole("heading", { level: 2, name }).closest("section") as HTMLElement;

beforeEach(() => {
  vi.stubEnv("VITE_USE_REAL_BUILDER", "true");
  requested = [];
});
afterEach(() => vi.unstubAllEnvs());

describe("Home on a warehouse (#527)", () => {
  it("has no KPI wall and asks for no run aggregate", async () => {
    handlers();
    renderHome();
    expect(await screen.findByRole("heading", { level: 1, name: "홈" })).toBeInTheDocument();
    await screen.findByRole("heading", { level: 2, name: "최근 스냅샷" });
    expect(screen.queryByText("TABLES")).not.toBeInTheDocument();
    expect(screen.queryByText("RUNNING")).not.toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(requested).toEqual([]);
    expect(screen.getByRole("link", { name: "새 SQL 질의" })).toHaveAttribute("href", "/sql");
  });

  it("lists only Stale, Degraded, Partial, Failed and Access problems, each one click from its table", async () => {
    handlers();
    renderHome();
    await screen.findByRole("heading", { level: 2, name: "조치가 필요한 테이블" });
    const attention = section("조치가 필요한 테이블");
    const links = within(attention).getAllByRole("link");
    expect(links.map((link) => link.getAttribute("href"))).toEqual(["/tables?attention=1", "/tables/air", "/tables/water", "/tables/rain"]);
    const water = within(attention).getByRole("link", { name: /수질/ });
    expect(within(water).getAllByText((_, element) => element?.getAttribute("data-status") === "actionable").map((badge) => badge.textContent)).toEqual([
      "완전성부분",
      "접근활용신청 필요",
    ]);
    // A healthy table, a cancelled refresh and an unknown health are not attention.
    expect(within(attention).queryByText("정상 테이블")).not.toBeInTheDocument();
    expect(within(attention).queryByText("취소된 갱신")).not.toBeInTheDocument();
  });

  it("leaves the attention section out when nothing needs attention", async () => {
    handlers({ datasets: [dataset("fine", "정상 테이블", axes())] });
    renderHome();
    await screen.findByRole("heading", { level: 2, name: "최근 스냅샷" });
    expect(screen.queryByRole("heading", { name: "조치가 필요한 테이블" })).not.toBeInTheDocument();
  });

  it("shows recent snapshots newest first, with the run only as a secondary column", async () => {
    handlers();
    renderHome();
    await waitFor(() => expect(within(section("최근 스냅샷")).getAllByRole("row")).toHaveLength(3));
    const table = section("최근 스냅샷");
    expect(within(table).getAllByRole("columnheader").map((cell) => cell.textContent)).toEqual(["테이블", "스냅샷", "행", "커밋 시각", "실행"]);
    const [, water, air] = within(table).getAllByRole("row");
    expect(within(water).getByRole("link", { name: "water.kma" })).toHaveAttribute("href", "/tables/water?source=kma");
    expect(water.querySelector('[data-status="missing"]')).not.toBeNull();
    expect(air).toHaveTextContent("snap_a");
    expect(air).toHaveTextContent("1,234");
    expect(air).toHaveTextContent("air.datago-run");
    // A table whose detail failed is left out, not shown with guessed values.
    expect(table).not.toHaveTextContent("broken.x");
  });

  it("opens a recent analysis in one click", async () => {
    handlers();
    renderHome();
    const link = await screen.findByRole("link", { name: /월별 PM10/ });
    expect(link).toHaveAttribute("href", "/sql?analysis=a1");
    expect(link).toHaveTextContent("air.datago@snap_a");
  });

  it("groups Access problems by provider as connections that need attention", async () => {
    handlers();
    renderHome();
    await screen.findByRole("heading", { level: 2, name: "연결 확인 필요" });
    const connections = section("연결 확인 필요");
    const items = within(connections).getAllByRole("link");
    expect(items).toHaveLength(1);
    expect(items[0]).toHaveAttribute("href", "/connections");
    expect(items[0]).toHaveTextContent("data.go.kr");
    expect(items[0]).toHaveTextContent("테이블 2개");
    expect(items[0]).toHaveTextContent("활용신청 필요");
  });
});

describe("Home reads recent snapshots from the table list summary (kpubdata-builder#841)", () => {
  it("asks no table detail when the list summarises each current snapshot; the run is then —", async () => {
    const details: string[] = [];
    const summarised = [
      {
        table_id: "t1",
        logical_name: "air.v2.datago",
        current_snapshot_id: "snap_a",
        revision: 1,
        current_snapshot: { snapshot_id: "snap_a", row_count: 1234, committed_at: "2026-09-01T00:00:00Z", coverage: null },
        dataset_id: "air.v2",
      },
      {
        table_id: "t2",
        logical_name: "water.kma",
        current_snapshot_id: "snap_w",
        revision: 1,
        current_snapshot: { snapshot_id: "snap_w", row_count: null, committed_at: "2026-09-03T00:00:00Z", coverage: null },
        dataset_id: "water",
      },
      { table_id: "t3", logical_name: "fresh.y", current_snapshot_id: null, revision: 0, current_snapshot: null, dataset_id: "fresh" },
    ];
    handlers();
    mswServer.use(
      http.get(`${API_BASE}/warehouse/tables`, () => HttpResponse.json({ tables: summarised })),
      http.get(`${API_BASE}/warehouse/tables/:name`, ({ params }) => {
        details.push(String(params.name));
        return HttpResponse.json({ code: "not_found", message: "gone" }, { status: 404 });
      }),
    );
    renderHome();

    await waitFor(() => expect(within(section("최근 스냅샷")).getAllByRole("row")).toHaveLength(3));
    const [, water, air] = within(within(section("최근 스냅샷")).getByRole("table")).getAllByRole("row");
    expect(water).toHaveTextContent("snap_w");
    // A row count Builder sent as null is unknown (`—`), never 0.
    const waterRows = water.querySelectorAll("td")[2];
    expect(waterRows.querySelector('[data-status="missing"]')).not.toBeNull();
    expect(waterRows).not.toHaveTextContent("0");
    expect(air).toHaveTextContent("1,234");
    // The dataset id Builder sent (it contains a dot) decides the link, not a split name.
    expect(within(air).getByRole("link", { name: "air.v2.datago" })).toHaveAttribute("href", "/tables/air.v2?source=datago");
    expect(air.querySelectorAll("td")[4].querySelector('[data-status="missing"]')).not.toBeNull();
    expect(details).toEqual([]);
  });
});

describe("Home with a snapshot id but no summary (#587)", () => {
  it("reads that table's detail once and shows its row", async () => {
    const details: string[] = [];
    const tables = [
      {
        table_id: "t1",
        logical_name: "lost.kma",
        current_snapshot_id: "snap_x",
        revision: 1,
        current_snapshot: null,
        dataset_id: "lost",
      },
      { table_id: "t2", logical_name: "fresh.y", current_snapshot_id: null, revision: 0, current_snapshot: null, dataset_id: "fresh" },
    ];
    handlers();
    mswServer.use(
      http.get(`${API_BASE}/warehouse/tables`, () => HttpResponse.json({ tables })),
      http.get(`${API_BASE}/warehouse/tables/:name`, ({ params }) => {
        const name = String(params.name);
        details.push(name);
        return HttpResponse.json({
          ...tables[0],
          snapshots: [
            {
              snapshot_id: "snap_x",
              run_id: "lost-run",
              state: "committed",
              row_count: 42,
              created_at: "2026-09-02T00:00:00Z",
              committed_at: "2026-09-02T00:00:00Z",
              coverage: null,
            },
          ],
        });
      }),
    );
    renderHome();

    await waitFor(() => expect(within(section("최근 스냅샷")).getAllByRole("row")).toHaveLength(2));
    const [, lost] = within(within(section("최근 스냅샷")).getByRole("table")).getAllByRole("row");
    expect(within(lost).getByRole("link", { name: "lost.kma" })).toHaveAttribute("href", "/tables/lost?source=kma");
    expect(lost).toHaveTextContent("snap_x");
    expect(lost).toHaveTextContent("42");
    expect(lost).toHaveTextContent("lost-run");
    expect(details).toEqual(["lost.kma"]);
  });
});

describe("Home without a warehouse (#527)", () => {
  it("keeps recent runs and says in one line why there are no snapshots or analyses", async () => {
    handlers({ warehouse: false });
    renderHome();
    expect(await screen.findByText(/이 배포에는 warehouse 가 없어/)).toBeInTheDocument();
    expect(await screen.findByRole("heading", { level: 2, name: "최근 실행" })).toBeInTheDocument();
    expect(await screen.findByRole("link", { name: /r1/ })).toHaveAttribute("href", "/refresh-jobs/r1");
    expect(screen.queryByRole("heading", { name: "최근 스냅샷" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "최근 분석" })).not.toBeInTheDocument();
  });
});

describe("Home for someone with nothing yet (#527)", () => {
  it("offers the two direct ways to start, without a workflow strip or a tour", async () => {
    handlers({ datasets: [], builds: [] });
    renderHome();
    expect(await screen.findByRole("link", { name: "탐색하기" })).toHaveAttribute("href", "/discover");
    expect(screen.getByRole("link", { name: "데이터 추가하기" })).toHaveAttribute("href", "/add");
    expect(screen.queryByText(/STEP 1/)).not.toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("shows the first-run checklist, and keeps it closed once closed (#412)", async () => {
    localStorage.clear();
    handlers({ datasets: [], builds: [] });
    const first = renderHome();
    const card = await screen.findByTestId("first-run-checklist");
    expect(within(card).getAllByRole("checkbox")).toHaveLength(4);
    expect(within(card).getByRole("link", { name: "활용신청 안내 보기" })).toHaveAttribute("href", "/connections");
    expect(within(card).getByRole("link", { name: "카탈로그 열기" })).toHaveAttribute("href", "/discover");

    fireEvent.click(within(card).getByRole("button", { name: "안내 닫기" }));
    expect(screen.queryByTestId("first-run-checklist")).not.toBeInTheDocument();
    first.unmount();

    renderHome();
    expect(await screen.findByRole("link", { name: "탐색하기" })).toBeInTheDocument();
    expect(screen.queryByTestId("first-run-checklist")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "시작 안내 다시 보기" })).toBeInTheDocument();
    localStorage.clear();
  });

  it("does not show the checklist to an account that already has tables (#412)", async () => {
    localStorage.clear();
    handlers();
    renderHome();
    expect(await screen.findByRole("heading", { level: 1, name: "홈" })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("heading", { level: 2, name: "조치가 필요한 테이블" })).toBeInTheDocument());
    expect(screen.queryByTestId("first-run-checklist")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "시작 안내 다시 보기" })).not.toBeInTheDocument();
  });
});
