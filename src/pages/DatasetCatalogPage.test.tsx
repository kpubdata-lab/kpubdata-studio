/**
 * Tables reads each current snapshot from the `GET /warehouse/tables` summary
 * (kpubdata-builder#841). A summary of `null` with a `current_snapshot_id` set is a
 * snapshot Builder committed but could not describe: unknown (`—`), never "not committed"
 * (#587).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { http, HttpResponse } from "msw";
import { mswServer } from "../../vitest.setup";
import { API_BASE } from "@/shared/config/env";
import { DatasetCatalogPage } from "./DatasetCatalogPage";

const dataset = (dataset_id: string, title: string) => ({
  dataset_id,
  title,
  sources: [{ provider: "data.go.kr", dataset: dataset_id, alias: dataset_id }],
  latest_run_id: `${dataset_id}-run`,
  status: "ok",
  updated_at: "2026-09-01T00:00:00Z",
  row_counts: {},
  total_row_count: 1,
  stages: {},
  quality: null,
  status_axes: { refresh: "succeeded", completeness: "complete", health: "healthy", access: "available", maturity: "beta" },
});

const DATASETS = [dataset("lost", "요약 없는 스냅샷"), dataset("fresh", "새 테이블")];

const TABLES = [
  { table_id: "t1", logical_name: "lost.kma", current_snapshot_id: "snap_x", revision: 1, current_snapshot: null, dataset_id: "lost" },
  { table_id: "t2", logical_name: "fresh.kma", current_snapshot_id: null, revision: 0, current_snapshot: null, dataset_id: "fresh" },
];

beforeEach(() => vi.stubEnv("VITE_USE_REAL_BUILDER", "true"));
afterEach(() => vi.unstubAllEnvs());

describe("Tables with a snapshot id but no summary (#587)", () => {
  it("shows the current snapshot as unknown, not as not committed", async () => {
    const details: string[] = [];
    mswServer.use(
      http.get(`${API_BASE}/datasets`, () => HttpResponse.json({ datasets: DATASETS, total: DATASETS.length })),
      http.get(`${API_BASE}/warehouse/tables`, () => HttpResponse.json({ tables: TABLES })),
      http.get(`${API_BASE}/warehouse/tables/:name`, ({ params }) => {
        details.push(String(params.name));
        return HttpResponse.json({ code: "not_found", message: "gone" }, { status: 404 });
      }),
    );
    render(
      <MemoryRouter>
        <DatasetCatalogPage />
      </MemoryRouter>,
    );

    const lost = await screen.findByLabelText("요약 없는 스냅샷 상세 열기");
    const snapshotCell = lost.querySelectorAll("td")[1];
    expect(snapshotCell.querySelector('[data-status="missing"]')).not.toBeNull();
    expect(snapshotCell).not.toHaveTextContent("커밋 전");
    expect(lost).not.toHaveTextContent("커밋 전");
    // A table with no id at all is still "not committed yet".
    const fresh = screen.getByLabelText("새 테이블 상세 열기");
    expect(fresh.querySelectorAll("td")[1]).toHaveTextContent("커밋 전");
    expect(details).toEqual([]);
  });
});
