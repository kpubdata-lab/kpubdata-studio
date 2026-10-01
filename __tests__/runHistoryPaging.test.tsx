/**
 * Run history past its first page (#653).
 *
 * Builder's run lists take only `limit` — no cursor — so "show more" asks again with a
 * larger one (50 → 150, 100 → 300 for the global history). Table Detail's run view and
 * its Snapshots tab ask with the same first limit, and a page shorter than its limit
 * offers no more.
 */
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { mswServer } from "../vitest.setup";
import * as datasetsApi from "@/features/datasets/api";
import * as runsApi from "@/features/runs/api";
import { BuildsPage } from "@/pages/BuildsPage";
import { DatasetDetailPage } from "@/pages/DatasetDetailPage";
import { API_BASE } from "@/shared/config/env";
import { useUIStore } from "@/shared/hooks/useUIStore";
import type { DatasetRunSummary } from "@/shared/lib/builderApi";
import type { BuildListItem } from "@/shared/lib/types";
import { hideDemoWarehouse } from "./support/noWarehouse";

function runs(count: number, prefix = "run"): DatasetRunSummary[] {
  return Array.from({ length: count }, (_, index) => ({
    run_id: `${prefix}-${String(index).padStart(3, "0")}`,
    status: "ok",
    started_at: "2026-09-01T00:00:00Z",
    finished_at: "2026-09-01T00:01:00Z",
    spec_digest: null,
    created_by: null,
  }));
}

function renderAt(path: string, element: React.ReactElement, route: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path={route} element={element} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  act(() => useUIStore.setState({ isAssistantDrawerOpen: false }));
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("Table Detail run view: show more (#653)", () => {
  beforeEach(() => {
    vi.stubEnv("VITE_USE_REAL_BUILDER", "false");
    hideDemoWarehouse();
  });

  it("asks for 50 first, then 150 when 'show more' is clicked, and shows the larger page", async () => {
    const spy = vi.spyOn(datasetsApi, "listDatasetRuns").mockImplementation(async (datasetId, limit = 50) => ({
      dataset_id: datasetId,
      runs: runs(limit === 50 ? 50 : 120),
    }));
    renderAt("/tables/air-quality?tab=builds", <DatasetDetailPage />, "/tables/:datasetId");

    const panel = await screen.findByRole("tabpanel", { name: "실행 기록" });
    await within(panel).findByText("run-049");
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][1]).toBe(50);
    expect(within(panel).getByText(/최근 실행 50건 \(최대 50건 요청\)/)).toBeInTheDocument();

    fireEvent.click(within(panel).getByRole("button", { name: "더 보기 (최대 150건)" }));

    await within(panel).findByText("run-119");
    expect(spy).toHaveBeenCalledTimes(2);
    expect(spy.mock.calls[1].slice(0, 2)).toEqual(["air-quality", 150]);
    // 120 < 150: Builder has no more, so no more is offered.
    expect(within(panel).getByText("접근 가능한 실행 120건을 모두 표시했습니다.")).toBeInTheDocument();
    expect(within(panel).queryByRole("button", { name: /더 보기/ })).not.toBeInTheDocument();
  });

  it("keeps the loaded runs and says why when the larger page is refused", async () => {
    const spy = vi.spyOn(datasetsApi, "listDatasetRuns").mockImplementation(async (datasetId, limit = 50) => {
      if (limit > 50) throw new Error("limit too large");
      return { dataset_id: datasetId, runs: runs(50) };
    });
    renderAt("/tables/air-quality?tab=builds", <DatasetDetailPage />, "/tables/:datasetId");

    const panel = await screen.findByRole("tabpanel", { name: "실행 기록" });
    await within(panel).findByText("run-049");
    fireEvent.click(within(panel).getByRole("button", { name: "더 보기 (최대 150건)" }));

    expect(await within(panel).findByRole("alert")).toHaveTextContent("너무 큰 limit");
    expect(within(panel).getByText("run-049")).toBeInTheDocument();
    expect(spy).toHaveBeenCalledTimes(2);
  });
});

describe("Table Detail Snapshots tab: same first limit and show more (#653)", () => {
  const limits: string[] = [];

  beforeEach(() => {
    vi.stubEnv("VITE_USE_REAL_BUILDER", "true");
    limits.length = 0;
    const table = {
      table_id: "air.air_quality",
      logical_name: "air.air_quality",
      current_snapshot_id: "snap-1",
      revision: 1,
      current_snapshot: { snapshot_id: "snap-1", row_count: 1, committed_at: "2026-09-02T00:00:00Z", coverage: null },
      dataset_id: "air",
    };
    mswServer.use(
      http.get(`${API_BASE}/warehouse/tables`, () => HttpResponse.json({ tables: [table] })),
      http.get(`${API_BASE}/warehouse/tables/:name`, () =>
        HttpResponse.json({
          ...table,
          snapshots: [{ snapshot_id: "snap-1", run_id: "run-000", state: "committed", created_at: "2026-09-02T00:00:00Z", row_count: 1, committed_at: "2026-09-02T00:00:00Z", coverage: null }],
        }),
      ),
      http.get(`${API_BASE}/datasets/air`, () =>
        HttpResponse.json({
          dataset_id: "air",
          title: "대기질",
          sources: [{ provider: "datago", dataset: "air_quality", alias: "" }],
          latest_run_id: "run-000",
          status: "ok",
          updated_at: "2026-09-02T00:00:00Z",
          row_counts: {},
          total_row_count: 1,
          stages: {},
          quality: null,
          status_axes: { refresh: "succeeded", completeness: "complete", health: "healthy", access: "available", maturity: "beta" },
          run_count: 1,
        }),
      ),
      http.get(`${API_BASE}/datasets/air/runs`, ({ request }) => {
        const limit = new URL(request.url).searchParams.get("limit") ?? "";
        limits.push(limit);
        return HttpResponse.json({ dataset_id: "air", runs: runs(Number(limit)) });
      }),
    );
  });

  it("asks with the run view's limit (50, not 20) and then 150", async () => {
    renderAt("/tables/air?tab=snapshots", <DatasetDetailPage />, "/tables/:datasetId");

    const panel = await screen.findByRole("tabpanel");
    await within(panel).findByText("run-049");
    expect(limits).toEqual(["50"]);

    fireEvent.click(within(panel).getByRole("button", { name: "더 보기 (최대 150건)" }));
    await within(panel).findByText("run-149");
    expect(limits).toEqual(["50", "150"]);
  });
});

describe("Refresh history: show more past 100 (#653)", () => {
  function items(count: number): BuildListItem[] {
    return Array.from({ length: count }, (_, index) => ({
      id: `build-${String(index).padStart(3, "0")}`,
      title: null,
      status: "succeeded",
      startedAt: null,
      finishedAt: null,
    }));
  }

  it("asks for 100 first and 300 after 'show more'", async () => {
    const spy = vi.spyOn(runsApi, "listBuilds").mockImplementation(async (limit) => items(limit === 100 ? 100 : 180));
    renderAt("/refresh-jobs", <BuildsPage />, "/refresh-jobs");

    await screen.findByText("build-099");
    expect(spy.mock.calls.map((call) => call[0])).toEqual([100]);

    fireEvent.click(screen.getByRole("button", { name: "더 보기 (최대 300건)" }));

    await screen.findByText("build-179");
    expect(spy.mock.calls.map((call) => call[0])).toEqual([100, 300]);
    await waitFor(() => expect(screen.queryByRole("button", { name: /더 보기/ })).not.toBeInTheDocument());
  });

  it("offers no more when the first page is short", async () => {
    vi.spyOn(runsApi, "listBuilds").mockResolvedValue(items(3));
    renderAt("/refresh-jobs", <BuildsPage />, "/refresh-jobs");

    await screen.findByText("build-002");
    expect(screen.getByText("접근 가능한 실행 3건을 모두 표시했습니다.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /더 보기/ })).not.toBeInTheDocument();
  });
});
