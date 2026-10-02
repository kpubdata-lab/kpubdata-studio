/**
 * Opening a saved analysis Builder will not run again as it is (builder#875, #565).
 *
 * The SQL Workspace loads its SQL and name as before and says it must be checked and
 * saved as a new analysis; an analysis in today's SQL shows no notice.
 */
import { render, screen } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { mswServer } from "../../../vitest.setup";
import { WarehouseWorkspace } from "./WarehouseWorkspace";
import { API_BASE } from "@/shared/config/env";

const TABLES = [{ table_id: "t1", logical_name: "air.datago", current_snapshot_id: "snap_a", revision: 1 }];

const saved = (analysis_id: string, migration_required: boolean) => ({
  analysis_id,
  name: `분석 ${analysis_id}`,
  sql: `SELECT ${analysis_id} FROM dataset`,
  limit: 100,
  bindings: [{ table: "air.datago", snapshot_id: "snap_a" }],
  result_meta: { columns: [], column_meta: [], row_count: 0, truncated: false, executed_at: "2026-09-01T00:00:00Z" },
  created_at: "2026-09-01T00:00:00Z",
  migration_required,
});

beforeEach(() => {
  vi.stubEnv("VITE_USE_REAL_BUILDER", "true");
  mswServer.use(
    http.get(`${API_BASE}/warehouse/tables/:name`, () => HttpResponse.json({ ...TABLES[0], snapshots: [] })),
    http.get(`${API_BASE}/analyses`, () => HttpResponse.json({ analyses: [saved("old", true), saved("new", false)] })),
  );
});
afterEach(() => vi.unstubAllEnvs());

const open = (analysis: string) =>
  render(
    <MemoryRouter initialEntries={[`/sql?table=air.datago&snapshot=snap_a&analysis=${analysis}`]}>
      <WarehouseWorkspace tables={TABLES} />
    </MemoryRouter>,
  );

describe("SQL Workspace with a saved analysis (#565)", () => {
  it("loads a legacy analysis and says to check it and save it as a new one", async () => {
    open("old");
    expect(await screen.findByDisplayValue("SELECT old FROM dataset")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("새 분석으로 저장하세요");
  });

  it("shows no notice for an analysis in today's SQL", async () => {
    open("new");
    expect(await screen.findByDisplayValue("SELECT new FROM dataset")).toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});
