/**
 * The warehouse SQL Workspace's table explorer and `FROM dataset` binding (#528).
 *
 * Tables are grouped by the dataset id in their logical name (`<dataset_id>.<source_key>`,
 * the only grouping the Builder contract gives). Columns load lazily from one row page.
 * Nothing here runs a query on its own: picking a table or inserting a column only edits.
 */
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it } from "vitest";

import { mswServer } from "../vitest.setup";
import { referencedTableNames } from "@/features/sql/tableReferences";
import { WarehouseWorkspace } from "@/features/sql/WarehouseWorkspace";
import { API_BASE } from "@/shared/config/env";

const TABLES = [
  { table_id: "t1", logical_name: "air_quality.datago__air", current_snapshot_id: "snap_3", revision: 3 },
  { table_id: "t2", logical_name: "air_quality.airkorea", current_snapshot_id: "snap_9", revision: 1 },
  { table_id: "t3", logical_name: "weather.kma", current_snapshot_id: null, revision: 0 },
];

const column = (name: string, logical_type: string) => ({ name, logical_type, wire_encoding: "json_native" });

let rowsRequests: Array<Record<string, unknown>>;
let queryRequests: Array<Record<string, unknown>>;

beforeEach(() => {
  rowsRequests = [];
  queryRequests = [];
  mswServer.use(
    http.get(`${API_BASE}/warehouse/tables/:name`, ({ params }) => {
      const table = TABLES.find((item) => item.logical_name === params.name)!;
      return HttpResponse.json({
        ...table,
        snapshots: table.current_snapshot_id
          ? [{ snapshot_id: table.current_snapshot_id, run_id: "r", state: "committed", row_count: 2, created_at: "x", committed_at: "x", coverage: null }]
          : [],
      });
    }),
    http.post(`${API_BASE}/warehouse/rows`, async ({ request }) => {
      const body = (await request.json()) as Record<string, unknown>;
      rowsRequests.push(body);
      return HttpResponse.json({
        snapshot: { table_id: "t1", logical_name: body.table, snapshot_id: "snap_3", revision: 3 },
        columns: ["station name", "pm10"],
        column_meta: [column("station name", "string"), column("pm10", "float64")],
        rows: [{ "station name": "a", pm10: 1 }],
        order: [],
        page: { offset: 0, page_size: 1, returned: 1, has_more: true, next_offset: 1 },
        count: { status: "not_computed", value: null },
        execution_ms: 1,
        startup_ms: 0,
        engine_execution_ms: 1,
      });
    }),
    http.post(`${API_BASE}/warehouse/query`, async ({ request }) => {
      const body = (await request.json()) as Record<string, unknown>;
      queryRequests.push(body);
      return HttpResponse.json({
        snapshot: { table_id: "t1", logical_name: body.table, snapshot_id: "snap_3", revision: 3 },
        result: { columns: ["pm10"], rows: [{ pm10: 1 }, { pm10: 2 }], truncated: false, execution_ms: 12 },
      });
    }),
  );
});

function renderAt(url = "/sql") {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <WarehouseWorkspace tables={TABLES} />
    </MemoryRouter>,
  );
}

const editor = () => screen.getByRole("textbox", { name: "SQL" }) as HTMLTextAreaElement;

describe("table explorer (#528)", () => {
  it("groups tables by the dataset id in logical_name and binds `dataset` to the picked table — one click to Run", async () => {
    renderAt();
    const tree = screen.getByRole("tree", { name: "테이블 탐색기" });
    expect(within(tree).getByRole("treeitem", { name: "air_quality" })).toHaveAttribute("aria-expanded", "true");
    expect(within(tree).getByRole("treeitem", { name: "weather" })).toBeInTheDocument();

    const binding = screen.getByTestId("dataset-binding");
    expect(binding).toHaveTextContent("dataset → —");
    expect(screen.getByRole("button", { name: /실행 ⌘/ })).toBeDisabled();

    fireEvent.click(within(tree).getByRole("treeitem", { name: "air_quality.datago__air" }));
    expect(binding).toHaveTextContent("dataset → air_quality.datago__air @ current");
    await waitFor(() => expect(binding).toHaveTextContent("dataset → air_quality.datago__air @ current (snap_3)"));
    expect(within(tree).getByRole("treeitem", { name: "air_quality.datago__air" })).toHaveAttribute("aria-selected", "true");

    fireEvent.click(screen.getByRole("button", { name: /실행 ⌘/ }));
    const footer = await screen.findByTestId("result-footer");
    expect(queryRequests).toEqual([{ table: "air_quality.datago__air", snapshot: "current", sql: "SELECT *\nFROM dataset\nLIMIT 100", limit: 100 }]);
    expect(footer).toHaveTextContent("2행 · 12 ms · snapshot snap_3 · rev 3 · LIMIT 100");
  });

  it("is keyboard navigable, loads columns lazily and inserts a column at the cursor without running", async () => {
    renderAt();
    const tree = screen.getByRole("tree", { name: "테이블 탐색기" });
    const group = within(tree).getByRole("treeitem", { name: "air_quality" });
    expect(group).toHaveAttribute("tabindex", "0");
    group.focus();

    fireEvent.keyDown(group, { key: "ArrowDown" });
    const table = within(tree).getByRole("treeitem", { name: "air_quality.datago__air" });
    expect(table).toHaveFocus();
    expect(rowsRequests).toHaveLength(0);

    fireEvent.keyDown(table, { key: "ArrowRight" });
    expect(table).toHaveAttribute("aria-expanded", "true");
    const columnItem = await within(tree).findByRole("treeitem", { name: /station name/ });
    expect(rowsRequests).toEqual([{ table: "air_quality.datago__air", snapshot: "current", page_size: 1, count: "none" }]);

    fireEvent.keyDown(table, { key: "ArrowDown" });
    expect(columnItem).toHaveFocus();

    // Put the cursor after "SELECT " and insert the column there.
    editor().setSelectionRange(7, 8);
    fireEvent.keyDown(columnItem, { key: "Enter" });
    expect(editor().value).toBe('SELECT "station name"\nFROM dataset\nLIMIT 100');
    // Inserting a column binds `dataset` to that column's table, and runs nothing.
    expect(screen.getByTestId("dataset-binding")).toHaveTextContent("dataset → air_quality.datago__air");
    expect(queryRequests).toHaveLength(0);

    fireEvent.keyDown(columnItem, { key: "ArrowLeft" });
    expect(table).toHaveFocus();
    fireEvent.keyDown(table, { key: "ArrowLeft" });
    expect(table).toHaveAttribute("aria-expanded", "false");
    fireEvent.keyDown(table, { key: "End" });
    expect(within(tree).getByRole("treeitem", { name: "weather.kma" })).toHaveFocus();
    fireEvent.keyDown(within(tree).getByRole("treeitem", { name: "weather.kma" }), { key: "Home" });
    expect(group).toHaveFocus();
  });

  it("a table without a current snapshot has no columns to list", async () => {
    renderAt();
    const tree = screen.getByRole("tree", { name: "테이블 탐색기" });
    const table = within(tree).getByRole("treeitem", { name: "weather.kma" });
    fireEvent.keyDown(table, { key: "ArrowRight" });
    expect(await within(tree).findByText("커밋된 스냅샷이 없습니다.")).toBeInTheDocument();
    expect(rowsRequests).toHaveLength(0);
  });

  it("says, before running, that a table name in FROM should be `dataset`", async () => {
    renderAt("/sql?table=air_quality.datago__air");
    fireEvent.change(editor(), { target: { value: "SELECT * FROM air_quality.datago__air" } });
    expect(screen.getByRole("note")).toHaveTextContent("air_quality.datago__air 대신 `FROM dataset`");
    fireEvent.change(editor(), { target: { value: "SELECT * FROM dataset" } });
    expect(screen.queryByRole("note")).not.toBeInTheDocument();
  });
});

describe("referencedTableNames (#528)", () => {
  const names = TABLES.map((item) => item.logical_name);

  it("finds a table name used as a relation, quoted or not, in any case", () => {
    expect(referencedTableNames("select * from AIR_QUALITY.datago__air", names)).toEqual(["air_quality.datago__air"]);
    expect(referencedTableNames('SELECT 1 FROM dataset JOIN "weather.kma" k ON true', names)).toEqual(["weather.kma"]);
  });

  it("ignores `dataset`, names in strings and columns that merely look alike", () => {
    expect(referencedTableNames("SELECT * FROM dataset WHERE note = 'from weather.kma'", names)).toEqual([]);
    expect(referencedTableNames("SELECT weather FROM dataset", names)).toEqual([]);
  });
});
