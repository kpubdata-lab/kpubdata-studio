/**
 * Warehouse SQL and Saved Analyses (#417), replayed against a stateful fake Builder:
 * tables → SQL → save → the table is refreshed → re-run reads the saved snapshot.
 */
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { http, HttpResponse } from "msw";

import { mswServer } from "../vitest.setup";
import { appRoutes } from "@/app/router";
import { API_BASE } from "@/shared/config/env";
import { useUIStore } from "@/shared/hooks/useUIStore";

const TABLE = "housing.trade";

interface Builder {
  current: string;
  analyses: Array<Record<string, unknown>>;
  runPaths: string[];
}

function fakeEngine(): Builder {
  const engine: Builder = { current: "s2", analyses: [], runPaths: [] };
  const result = (snapshotId: string) => ({
    columns: ["snapshot"],
    column_meta: [{ name: "snapshot", logical_type: "string", wire_encoding: "string" }],
    rows: [{ snapshot: snapshotId }],
    truncated: false,
    execution_ms: 1,
  });
  mswServer.use(
    http.get(`${API_BASE}/version`, () => HttpResponse.json({ service: "kpubdata-builder", api_version: "1.39.0", version: "0.4.0" })),
    http.get(`${API_BASE}/warehouse/tables`, () =>
      HttpResponse.json({ tables: [{ table_id: "t1", logical_name: TABLE, current_snapshot_id: engine.current, revision: 2 }] }),
    ),
    http.get(`${API_BASE}/warehouse/tables/${TABLE}`, () =>
      HttpResponse.json({
        table_id: "t1",
        logical_name: TABLE,
        current_snapshot_id: engine.current,
        revision: 2,
        snapshots: [
          { snapshot_id: engine.current, run_id: "r2", state: "committed", row_count: 10, created_at: "2026-09-29T00:00:00Z", committed_at: "2026-09-29T00:00:01Z" },
        ],
      }),
    ),
    http.post(`${API_BASE}/warehouse/query`, async ({ request }) => {
      const body = (await request.json()) as { snapshot?: string };
      const read = !body.snapshot || body.snapshot === "current" ? engine.current : body.snapshot;
      return HttpResponse.json({ snapshot: { table_id: "t1", logical_name: TABLE, snapshot_id: read, revision: 2 }, result: result(read) });
    }),
    http.post(`${API_BASE}/analyses`, async ({ request }) => {
      const body = (await request.json()) as { name: string; sql: string; snapshot?: string };
      const read = !body.snapshot || body.snapshot === "current" ? engine.current : body.snapshot;
      const analysis = {
        analysis_id: `a${engine.analyses.length + 1}`,
        name: body.name,
        sql: body.sql,
        limit: 100,
        bindings: [{ table: TABLE, snapshot_id: read }],
        result_meta: { columns: ["snapshot"], column_meta: [], row_count: 1, truncated: false, executed_at: "2026-09-29T00:00:02Z" },
        created_at: "2026-09-29T00:00:02Z",
      };
      engine.analyses.unshift(analysis);
      return HttpResponse.json({ analysis, result: result(read) });
    }),
    http.get(`${API_BASE}/analyses`, () => HttpResponse.json({ analyses: engine.analyses })),
    http.post(`${API_BASE}/analyses/:id/run`, ({ params, request }) => {
      engine.runPaths.push(new URL(request.url).pathname);
      const saved = engine.analyses.find((a) => a.analysis_id === params.id) as { bindings: Array<{ snapshot_id: string }> };
      const read = saved.bindings[0].snapshot_id;
      return HttpResponse.json({ snapshot: { table_id: "t1", logical_name: TABLE, snapshot_id: read, revision: 3 }, result: result(read) });
    }),
    http.delete(`${API_BASE}/analyses/:id`, ({ params }) => {
      engine.analyses = engine.analyses.filter((a) => a.analysis_id !== params.id);
      return HttpResponse.json({ analysis_id: params.id, deleted: true });
    }),
  );
  return engine;
}

function renderApp(path: string) {
  const router = createMemoryRouter(appRoutes, { initialEntries: [path] });
  render(<RouterProvider router={router} />);
  return router;
}

beforeEach(() => {
  vi.stubEnv("VITE_USE_REAL_BUILDER", "true");
  vi.stubEnv("VITE_DEV_BYPASS_AUTH", "true");
  act(() => useUIStore.setState({ theme: "light", isMobileSidebarOpen: false, isAssistantDrawerOpen: false }));
});
afterEach(() => vi.unstubAllEnvs());

describe("saved analyses against a warehouse (#417)", () => {
  it("tables → SQL → save → refresh → re-run reads the saved snapshot", async () => {
    const engine = fakeEngine();
    const router = renderApp("/sql");

    fireEvent.click(await screen.findByRole("treeitem", { name: TABLE }));
    await screen.findByRole("option", { name: /s2 · 10행/ });
    fireEvent.click(screen.getByRole("button", { name: /실행 ⌘/ }));
    expect(await screen.findByText(`${TABLE}@s2 · rev 2`)).toBeInTheDocument();

    fireEvent.change(screen.getByRole("textbox", { name: "분석 이름" }), { target: { value: "구별 거래" } });
    fireEvent.click(screen.getByRole("button", { name: "실행하고 저장" }));
    expect(await screen.findByRole("status")).toHaveTextContent('"구별 거래" 을 읽은 스냅샷과 함께 저장했습니다.');

    // The table is refreshed: current moves to s3.
    engine.current = "s3";
    await act(async () => {
      await router.navigate("/analyses");
    });
    const card = (await screen.findByRole("heading", { name: "구별 거래" })).closest("div.flex.flex-col") as HTMLElement;
    expect(within(card).getByText(`${TABLE}@s2`)).toBeInTheDocument();
    fireEvent.click(within(card).getByRole("button", { name: "다시 실행" }));

    expect(await within(card).findByText(`${TABLE}@s2 · rev 3`)).toBeInTheDocument();
    expect(within(card).getAllByText("s2").length).toBeGreaterThan(0);
    expect(within(card).queryByText("s3")).not.toBeInTheDocument();
    expect(engine.runPaths).toEqual(["/analyses/a1/run"]);
  });

  it("deletes an analysis after confirming", async () => {
    const engine = fakeEngine();
    engine.analyses.push({
      analysis_id: "a9",
      name: "지울 분석",
      sql: "SELECT 1",
      limit: 100,
      bindings: [{ table: TABLE, snapshot_id: "s1" }],
      result_meta: { columns: [], column_meta: [], row_count: 0, truncated: false, executed_at: "2026-09-29T00:00:00Z" },
      created_at: "2026-09-29T00:00:00Z",
    });
    vi.spyOn(window, "confirm").mockReturnValue(true);
    renderApp("/analyses");
    fireEvent.click(await screen.findByRole("button", { name: "삭제" }));
    await waitFor(() => expect(screen.queryByRole("heading", { name: "지울 분석" })).not.toBeInTheDocument());
    expect(engine.analyses).toHaveLength(0);
  });
});

describe("without a warehouse (#417)", () => {
  beforeEach(() => {
    mswServer.use(
      http.get(`${API_BASE}/version`, () => HttpResponse.json({ service: "kpubdata-builder", api_version: "1.36.0" })),
      http.get(`${API_BASE}/warehouse/tables`, () =>
        HttpResponse.json({ error: "no warehouse", code: "warehouse_not_configured" }, { status: 404 }),
      ),
      http.get(`${API_BASE}/datasets`, () => HttpResponse.json({ datasets: [], total: 0 })),
    );
  });

  it("SQL Workspace keeps querying runs, with no save", async () => {
    renderApp("/sql");
    expect(await screen.findByText("질의할 테이블을 선택하세요.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "실행하고 저장" })).not.toBeInTheDocument();
  });

  it("Saved Analyses says this deployment cannot keep them", async () => {
    renderApp("/analyses");
    expect(await screen.findByText(/웨어하우스가 있는 KPubData Builder 가 필요합니다/)).toBeInTheDocument();
  });
});
