/**
 * One data table for Builder values (#499): exact cells, honest totals, a pinned snapshot.
 */
import { act, fireEvent, render, renderHook, screen, waitFor, within } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";

import { mswServer } from "../vitest.setup";
import { DataTable, totalStatusOf } from "@/features/data-table/DataTable";
import { rowsRequest, useWarehouseRows } from "@/features/data-table/useWarehouseRows";
import { ResultTable } from "@/features/sql/ResultTable";
import { API_BASE } from "@/shared/config/env";
import { warehouseRowsResponseSchema, type WarehouseRowsResponse } from "@/shared/lib/builderApi.schema";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const COLUMNS = ["zip", "code19", "big", "amount", "missing", "day"];
const META = [
  { name: "zip", logical_type: "string", wire_encoding: "string" as const },
  { name: "code19", logical_type: "string", wire_encoding: "string" as const },
  { name: "big", logical_type: "int64", wire_encoding: "decimal_string" as const },
  { name: "amount", logical_type: "decimal", wire_encoding: "decimal_string" as const },
  { name: "missing", logical_type: "int64", wire_encoding: "number" as const },
  { name: "day", logical_type: "date", wire_encoding: "string" as const },
];
const ROW = {
  zip: "06102",
  code19: "1234567890123456789",
  big: "9007199254740993",
  amount: "12345.6700",
  missing: null,
  day: "2026-09-30",
};

function page(snapshot: string, offset: number, hasMore: boolean): WarehouseRowsResponse {
  return {
    snapshot: { table_id: "t1", logical_name: "air", snapshot_id: snapshot, revision: 3 },
    columns: ["n"],
    column_meta: [{ name: "n", logical_type: "int64", wire_encoding: "number" }],
    rows: [{ n: offset }, { n: offset + 1 }],
    order: [],
    page: { offset, page_size: 2, returned: 2, has_more: hasMore, next_offset: hasMore ? offset + 2 : null },
    count: { status: "not_computed", value: null },
    execution_ms: 1,
    startup_ms: 0,
    engine_execution_ms: 1,
  };
}

describe("DataTable cells keep the exact text (#499, #484)", () => {
  it("shows zero-led and 19-digit codes, an unsafe integer, a Decimal, null and a date as sent", () => {
    render(<DataTable columnMeta={META} columns={COLUMNS} rowTotal={{ returned: 1, total: 1, status: "exact" }} rows={[ROW]} />);
    const cells = within(screen.getAllByRole("row")[1]).getAllByRole("cell").map((cell) => cell.textContent);
    expect(cells).toEqual(["06102", "1234567890123456789", "9007199254740993", "12345.6700", "—", "2026-09-30"]);
  });

  it("never parses numbers in the table code", () => {
    for (const file of ["src/features/data-table/DataTable.tsx", "src/features/data-table/TableRowsPanel.tsx"]) {
      const source = readFileSync(join(ROOT, file), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
      expect(source).not.toMatch(/\bNumber\(|parseFloat|parseInt/);
    }
  });
});

describe("DataTable totals say how they are known (#499)", () => {
  it.each([
    [{ returned: 2, total: 40, status: "exact" as const }, /2행 표시 · 전체 40행 \(정확\)/],
    [{ returned: 2, total: null, status: "not_computed" as const }, /전체 건수 계산 안 함/],
    [{ returned: 2, total: null, status: "unknown" as const }, /전체 건수 알 수 없음/],
    [{ returned: 2, total: 40, status: "estimated" as const }, /전체 약 40행 \(추정\)/],
  ])("%o", (rowTotal, text) => {
    render(<DataTable columns={["n"]} rowTotal={rowTotal} rows={[{ n: 1 }, { n: 2 }]} />);
    expect(screen.getByTestId("row-total")).toHaveTextContent(text);
  });

  it("does not write a total it was not given as 0", () => {
    render(<DataTable columns={["n"]} rowTotal={{ returned: 2, total: null, status: "not_computed" }} rows={[{ n: 1 }, { n: 2 }]} />);
    expect(screen.getByTestId("row-total").textContent).not.toMatch(/전체 0/);
  });

  it("keeps an unknown count status unknown", () => {
    expect(totalStatusOf("sampled")).toBe("unknown");
    expect(totalStatusOf("exact")).toBe("exact");
  });

  it("a cut SQL result does not claim a total", () => {
    render(
      <ResultTable
        result={{ columns: ["n"], rows: [{ n: 1 }], truncated: true, execution_ms: 3, column_meta: [] }}
        target="air@s1"
      />,
    );
    expect(screen.getByTestId("row-total")).toHaveTextContent(/전체 건수 알 수 없음/);
    expect(screen.getByText(/잘림/)).toBeInTheDocument();
  });
});

describe("DataTable column headers (#499, builder#813)", () => {
  it("shows the label, logical type and unit, and marks an inferred hint", () => {
    render(
      <DataTable
        columnMeta={[
          {
            name: "amt",
            logical_type: "decimal",
            wire_encoding: "decimal_string",
            display: { label: "거래금액", origin: "core_spec" },
            unit: { name: "원", scale: 10000, origin: "engine_inferred" },
          },
        ]}
        columns={["amt"]}
        rowTotal={{ returned: 0, total: 0, status: "exact" }}
        rows={[]}
      />,
    );
    const header = screen.getByRole("columnheader");
    expect(header).toHaveTextContent("거래금액");
    expect(header).toHaveTextContent("amt");
    expect(header).toHaveTextContent("decimal · 단위 ×10000 원 · 추정");
  });
});

describe("paging keeps one snapshot (#499)", () => {
  it("asks for current first, then the snapshot the first page named", () => {
    expect(rowsRequest("air", "current", null, 0, 50).snapshot).toBe("current");
    expect(rowsRequest("air", "current", "s1", 50, 50).snapshot).toBe("s1");
  });

  it("every later page reads the pinned snapshot, even after a refresh changed current", async () => {
    const asked: string[] = [];
    const fetchPage = vi.fn(async (request: { snapshot?: string; offset?: number }) => {
      asked.push(request.snapshot ?? "");
      // After page 1 a refresh commits s2; only a request for `current` would see it.
      const served = request.snapshot === "current" ? (asked.length === 1 ? "s1" : "s2") : request.snapshot!;
      return page(served, request.offset ?? 0, (request.offset ?? 0) < 4);
    });
    const { result } = renderHook(() => useWarehouseRows("air", "current", 2, fetchPage));
    await act(async () => void (await result.current.start()));
    await act(async () => void (await result.current.next()));
    await act(async () => void (await result.current.next()));
    await act(async () => void (await result.current.previous()));
    expect(asked).toEqual(["current", "s1", "s1", "s1"]);
    expect(result.current.state.status === "ready" && result.current.state.page.snapshot.snapshot_id).toBe("s1");
  });

  it("the response schema reads builder#815's page", () => {
    expect(warehouseRowsResponseSchema.parse(page("s1", 0, true)).page.next_offset).toBe(2);
  });

  it("the rows panel pages through Builder over HTTP on one snapshot", async () => {
    const bodies: Array<{ snapshot?: string; offset?: number }> = [];
    mswServer.use(
      http.post(`${API_BASE}/warehouse/rows`, async ({ request }) => {
        const body = (await request.json()) as { snapshot?: string; offset?: number };
        bodies.push(body);
        return HttpResponse.json(page("s1", body.offset ?? 0, (body.offset ?? 0) === 0));
      }),
    );
    const { TableRowsPanel } = await import("@/features/data-table/TableRowsPanel");
    render(<TableRowsPanel snapshot="current" table="air" />);
    fireEvent.click(screen.getByRole("button", { name: "행 보기" }));
    await screen.findByText(/스냅샷 s1 고정/);
    fireEvent.click(screen.getByRole("button", { name: "다음" }));
    await waitFor(() => expect(screen.getByTestId("row-total")).toHaveTextContent("3–4행 표시"));
    expect(bodies.map((body) => body.snapshot)).toEqual(["current", "s1"]);
  });
});

describe("SQL results and stage samples share the table (#499)", () => {
  it.each(["src/features/sql/ResultTable.tsx", "src/pages/DatasetDetailPage.tsx"])("%s draws Builder rows with DataTable", (file) => {
    const source = readFileSync(join(ROOT, file), "utf8");
    expect(source).toMatch(/<DataTable\b/);
    expect(source).not.toMatch(/cellValue\(/);
  });
});
