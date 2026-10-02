/**
 * Saved Analyses after Builder's SQL changed (builder#875, #565).
 *
 * An analysis saved before the change carries `migration_required`; Builder refuses to
 * re-run it with 409 `analysis_migration_required`. The page does not offer "Run again"
 * for it, says why and what to do, and still lets the user open and delete it. An
 * analysis from an older Builder (no dialect fields) is read as before.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { http, HttpResponse } from "msw";
import { mswServer } from "../../vitest.setup";
import { API_BASE } from "@/shared/config/env";
import { AnalysesPage } from "./AnalysesPage";

const resultMeta = { columns: ["n"], column_meta: [], row_count: 1, truncated: false, executed_at: "2026-09-01T00:00:00Z" };

const analysis = (analysis_id: string, name: string, extra: Record<string, unknown> = {}) => ({
  analysis_id,
  name,
  sql: "SELECT count(*) AS n FROM dataset",
  limit: 100,
  bindings: [{ table: "air.datago", snapshot_id: "snap_a" }],
  result_meta: resultMeta,
  created_at: "2026-09-01T00:00:00Z",
  ...extra,
});

const LEGACY = analysis("a_old", "예전 분석", {
  sql_dialect: "legacy-polars",
  engine: "polars",
  engine_version: null,
  query_contract_version: null,
  migration_required: true,
});
const CURRENT = analysis("a_new", "새 분석", {
  sql_dialect: "duckdb",
  engine: "duckdb",
  engine_version: "1.5.6",
  query_contract_version: "1.75.0",
  migration_required: false,
});
const OLDER_BUILDER = analysis("a_plain", "이전 Builder 의 분석");

let runs: string[];

function handlers(analyses: unknown[]) {
  mswServer.use(
    http.get(`${API_BASE}/warehouse/tables`, () =>
      HttpResponse.json({ tables: [{ table_id: "t1", logical_name: "air.datago", current_snapshot_id: "snap_a", revision: 1 }] }),
    ),
    http.get(`${API_BASE}/analyses`, () => HttpResponse.json({ analyses })),
    http.post(`${API_BASE}/analyses/:id/run`, ({ params }) => {
      runs.push(String(params.id));
      return HttpResponse.json(
        { error: "saved in another SQL dialect", code: "analysis_migration_required", sql_dialect: "legacy-polars" },
        { status: 409 },
      );
    }),
  );
}

const card = async (name: string) => (await screen.findByRole("heading", { level: 2, name })).closest("div.flex.flex-col") as HTMLElement;

beforeEach(() => {
  vi.stubEnv("VITE_USE_REAL_BUILDER", "true");
  runs = [];
});
afterEach(() => vi.unstubAllEnvs());

describe("Saved Analyses after Builder's SQL changed (#565)", () => {
  it("does not offer Run again for a legacy analysis and says what to do", async () => {
    handlers([LEGACY, CURRENT]);
    render(
      <MemoryRouter>
        <AnalysesPage />
      </MemoryRouter>,
    );

    const legacy = await card("예전 분석");
    expect(within(legacy).getByRole("button", { name: "다시 실행" })).toBeDisabled();
    expect(within(legacy).getByRole("status")).toHaveTextContent("다시 실행하기 전에 확인이 필요합니다");
    expect(within(legacy).getByRole("link", { name: "SQL Workspace 에서 열기" })).toHaveAttribute(
      "href",
      expect.stringContaining("analysis=a_old"),
    );
    expect(within(legacy).getByRole("button", { name: "삭제" })).toBeEnabled();

    const current = await card("새 분석");
    expect(within(current).getByRole("button", { name: "다시 실행" })).toBeEnabled();
    expect(within(current).queryByRole("status")).not.toBeInTheDocument();
  });

  it("never names the engines behind the change", async () => {
    handlers([LEGACY]);
    render(
      <MemoryRouter>
        <AnalysesPage />
      </MemoryRouter>,
    );
    await card("예전 분석");
    expect(document.body.textContent ?? "").not.toMatch(/polars|duckdb/i);
  });

  it("reads Builder's 409 as the same notice when a list was stale", async () => {
    // The list says nothing (an older Builder's shape), but the run is refused.
    handlers([OLDER_BUILDER]);
    render(
      <MemoryRouter>
        <AnalysesPage />
      </MemoryRouter>,
    );
    const plain = await card("이전 Builder 의 분석");
    const rerun = within(plain).getByRole("button", { name: "다시 실행" });
    expect(rerun).toBeEnabled();

    fireEvent.click(rerun);

    expect(await within(plain).findByRole("status")).toHaveTextContent("다시 실행하기 전에 확인이 필요합니다");
    expect(runs).toEqual(["a_plain"]);
    expect(within(plain).queryByRole("alert")).not.toBeInTheDocument();
  });
});
