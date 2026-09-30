/**
 * Table Detail Preview pages the pinned snapshot, and a run sample says it is a sample (#537).
 *
 * On a warehouse, Preview reads `POST /warehouse/rows` for the snapshot on screen: every
 * page names that snapshot id, so a refresh committed while paging does not splice two
 * snapshots, and the footer says how the total is known — a count Builder did not compute
 * is never written as 0. Without a warehouse, Preview is the run's stored sample: it says
 * "N rows · sample" and offers no paging, because there is nothing behind it to page.
 */
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from "vitest";

import { mswServer } from "../vitest.setup";
import { hideDemoWarehouse } from "./support/noWarehouse";
import { DatasetDetailPage } from "@/pages/DatasetDetailPage";
import { API_BASE } from "@/shared/config/env";
import { useUIStore } from "@/shared/hooks/useUIStore";

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
  sources: [{ provider: "data.go.kr", dataset: "air", alias: "서울 대기질" }],
  latest_run_id: "run-2",
  status: "ok",
  updated_at: "2026-09-02T00:00:00Z",
  row_counts: {},
  total_row_count: 120,
  stages: {},
  quality: null,
  status_axes: { refresh: "succeeded", completeness: "complete", health: "healthy", access: "available", maturity: "beta" },
  run_count: 1,
};

const snapshot = (snapshot_id: string, run_id: string) => ({
  snapshot_id,
  run_id,
  state: "committed",
  row_count: 120,
  created_at: "2026-09-02T00:00:00Z",
  committed_at: "2026-09-02T00:00:00Z",
  coverage: null,
});

/** What the warehouse says is current; a test moves it to simulate a refresh commit. */
let current = "snap_2";
let rowsRequests: Array<Record<string, unknown>>;
let countStatus: { status: string; value: number | null };

beforeEach(() => {
  vi.stubEnv("VITE_USE_REAL_BUILDER", "true");
  act(() => useUIStore.setState({ isAssistantDrawerOpen: false }));
  current = "snap_2";
  rowsRequests = [];
  countStatus = { status: "exact", value: 120 };
  mswServer.use(
    http.get(`${API_BASE}/warehouse/tables`, () =>
      HttpResponse.json({ tables: [{ table_id: "t1", logical_name: "air.datago", current_snapshot_id: current, revision: 2 }] }),
    ),
    http.get(`${API_BASE}/warehouse/tables/:name`, () =>
      HttpResponse.json({
        table_id: "t1",
        logical_name: "air.datago",
        current_snapshot_id: current,
        revision: 2,
        snapshots: [snapshot(current, "run-2")],
      }),
    ),
    http.get(`${API_BASE}/datasets/air`, () => HttpResponse.json(DATASET)),
    http.get(`${API_BASE}/datasets/air/runs`, () =>
      HttpResponse.json({
        dataset_id: "air",
        runs: [{ run_id: "run-2", status: "ok", started_at: "2026-09-01T00:00:00Z", finished_at: null, spec_digest: null, created_by: null }],
      }),
    ),
    http.get(`${API_BASE}/builds/:run/quality`, ({ params }) =>
      HttpResponse.json({ run_id: params.run, availability: "available", evaluated_checks: 0, quality_results: {}, schema_drift: {} }),
    ),
    http.post(`${API_BASE}/warehouse/rows`, async ({ request }) => {
      const body = (await request.json()) as Record<string, unknown>;
      rowsRequests.push(body);
      const offset = typeof body.offset === "number" ? body.offset : 0;
      // A snapshot the request did not name is the one `current` resolves to right now.
      const snapshotId = body.snapshot === "current" ? current : body.snapshot;
      return HttpResponse.json({
        snapshot: { table_id: "t1", logical_name: body.table, snapshot_id: snapshotId, revision: 2 },
        columns: ["region_code"],
        column_meta: [{ name: "region_code", logical_type: "string", wire_encoding: "string" }],
        rows: [{ region_code: `${String(snapshotId)}-row-${offset}` }],
        order: [],
        page: { offset, page_size: 50, returned: 1, has_more: offset < 100, next_offset: offset < 100 ? offset + 50 : null },
        count: countStatus,
        execution_ms: 1,
        startup_ms: 0,
        engine_execution_ms: 1,
      });
    }),
  );
});
afterEach(() => vi.unstubAllEnvs());

describe("Table Detail Preview on a warehouse (#537)", () => {
  it("keeps paging the same snapshot after a refresh commits a new one", async () => {
    renderDetail("/tables/air?tab=preview");
    const preview = await screen.findByRole("tabpanel", { name: "미리보기" });
    await within(preview).findByText("snap_2-row-0");

    // A refresh commits while the person is reading page 1.
    current = "snap_3";
    fireEvent.click(within(preview).getByRole("button", { name: "다음" }));
    await within(preview).findByText("snap_2-row-50");

    expect(rowsRequests.map((request) => [request.snapshot, request.offset])).toEqual([
      ["snap_2", 0],
      ["snap_2", 50],
    ]);
    expect(within(preview).getByTestId("row-total")).toHaveTextContent("전체 120행 (정확)");
  });

  it("says a count Builder did not compute is not computed, never 0", async () => {
    countStatus = { status: "not_computed", value: null };
    renderDetail("/tables/air?tab=preview");
    const preview = await screen.findByRole("tabpanel", { name: "미리보기" });
    await within(preview).findByText("snap_2-row-0");

    const total = within(preview).getByTestId("row-total");
    expect(total).toHaveTextContent("전체 건수 계산 안 함");
    expect(total).not.toHaveTextContent(/전체 0행/);
  });
});

describe("Table Detail Preview without a warehouse (#537)", () => {
  it("labels the run sample as a sample and offers no paging", async () => {
    vi.stubEnv("VITE_USE_REAL_BUILDER", "false");
    // The demo has a warehouse since #530; this is a deployment without one.
    const hidden = hideDemoWarehouse();
    onTestFinished(() => hidden.mockRestore());
    renderDetail("/tables/air-quality?tab=preview&stage=silver");

    const total = await screen.findByTestId("row-total");
    await waitFor(() => expect(total).toHaveTextContent(/^\d+행 · 샘플$/));
    expect(screen.queryByRole("button", { name: "다음" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "이전" })).not.toBeInTheDocument();
  });
});
