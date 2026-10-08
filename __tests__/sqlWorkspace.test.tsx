/**
 * SQL Workspace (#417): the person runs the query, and the result names the
 * snapshot it read. Mock mode returns demo rows, labelled as such.
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { http, HttpResponse } from "msw";

import { mswServer } from "../vitest.setup";
import { API_BASE } from "@/shared/config/env";
import { SqlWorkspacePage } from "@/pages/SqlWorkspacePage";
import { hideDemoWarehouse } from "./support/noWarehouse";

function Where() {
  const { search } = useLocation();
  return <output data-testid="where">{search}</output>;
}

function renderAt(url: string) {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <Where />
      <Routes>
        <Route element={<SqlWorkspacePage />} path="/sql" />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => vi.stubEnv("VITE_USE_REAL_BUILDER", "false"));
afterEach(() => vi.unstubAllEnvs());

describe("SQL Workspace (#417)", () => {
  // The run-based workspace: a deployment without a warehouse (#530).
  beforeEach(() => {
    hideDemoWarehouse();
  });
  it("does not run anything until the person asks", async () => {
    renderAt("/sql?table=air-quality");
    await screen.findByRole("option", { name: /air-2026-08-14 \(최신\)/ });
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("needs a table before it can run", async () => {
    renderAt("/sql");
    expect(await screen.findByText("질의할 테이블을 선택하세요.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /실행/ })).toBeDisabled();
  });

  it("says in one line that the table explorer needs a warehouse (#528)", async () => {
    renderAt("/sql");
    expect(await screen.findByTestId("explorer-fallback")).toHaveTextContent(
      "테이블 탐색기와 스냅샷 고정은 웨어하우스가 있는 KPubData Builder 에서 쓸 수 있습니다.",
    );
    expect(screen.queryByRole("tree")).not.toBeInTheDocument();
  });

  it("asks which source when the run has several, and names the snapshot it read", async () => {
    renderAt("/sql?table=air-quality");
    const source = await screen.findByRole("combobox", { name: "소스" });
    expect(screen.getByRole("button", { name: /실행/ })).toBeDisabled();

    fireEvent.change(source, { target: { value: "datago__air" } });
    await waitFor(() => expect(screen.getByTestId("where")).toHaveTextContent("source=datago__air"));
    fireEvent.click(screen.getByRole("button", { name: /실행/ }));

    expect(await screen.findByRole("table")).toBeInTheDocument();
    expect(screen.getByText("air-quality@air-2026-08-14 · gold · datago__air")).toBeInTheDocument();
    expect(screen.getByText(/DEMO|데모/)).toBeInTheDocument();
  });
});

describe("SQL Workspace against KPubData Builder (#417)", () => {
  beforeEach(() => vi.stubEnv("VITE_USE_REAL_BUILDER", "true"));

  it("sends exactly the pinned snapshot and shows the Builder's refusal", async () => {
    let body: unknown;
    mswServer.use(
      http.get(`${API_BASE}/datasets`, () =>
        HttpResponse.json({ datasets: [], total: 0 }),
      ),
      http.get(`${API_BASE}/datasets/t1/runs`, () =>
        HttpResponse.json({ dataset_id: "t1", runs: [{ run_id: "r9", status: "ok", started_at: null, finished_at: null, spec_digest: null, created_by: null }] }),
      ),
      http.get(`${API_BASE}/builds/r9/stages`, () =>
        HttpResponse.json({ run_id: "r9", sources: [] }),
      ),
      http.post(`${API_BASE}/query`, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ error: "only read-only SELECT queries are allowed", code: "unsafe_query" }, { status: 400 });
      }),
    );
    renderAt("/sql?table=t1&stage=silver");
    await screen.findByRole("option", { name: /r9/ });
    fireEvent.change(screen.getByLabelText("SQL"), { target: { value: "DELETE FROM dataset" } });
    fireEvent.click(screen.getByRole("button", { name: /실행/ }));

    expect(await screen.findByRole("alert")).toHaveTextContent("unsafe_query");
    expect(body).toEqual({ dataset_id: "t1", run_id: "r9", stage: "silver", sql: "DELETE FROM dataset" });
  });

  it("shows a decimal_string column as the exact text the Builder sent (#484)", async () => {
    mswServer.use(
      http.get(`${API_BASE}/datasets`, () => HttpResponse.json({ datasets: [], total: 0 })),
      http.get(`${API_BASE}/datasets/t1/runs`, () =>
        HttpResponse.json({ dataset_id: "t1", runs: [{ run_id: "r9", status: "ok", started_at: null, finished_at: null, spec_digest: null, created_by: null }] }),
      ),
      http.get(`${API_BASE}/builds/r9/stages`, () => HttpResponse.json({ run_id: "r9", sources: [] })),
      http.post(`${API_BASE}/query`, () =>
        HttpResponse.json({
          columns: ["id", "amount"],
          column_meta: [
            { name: "id", logical_type: "int64", wire_encoding: "decimal_string" },
            { name: "amount", logical_type: "decimal", wire_encoding: "decimal_string" },
          ],
          rows: [{ id: "9007199254740993", amount: "0.10" }],
          truncated: false,
          execution_ms: 1,
        }),
      ),
    );
    renderAt("/sql?table=t1");
    await screen.findByRole("option", { name: /r9/ });
    fireEvent.click(screen.getByRole("button", { name: /실행/ }));
    // The cell's whole text: its digits are drawn in threes, in elements of their own (#844).
    expect(await screen.findByRole("cell", { name: "9007199254740993" })).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "0.10" })).toBeInTheDocument();
    expect(screen.queryByRole("cell", { name: "9007199254740992" })).not.toBeInTheDocument();
  });
});
