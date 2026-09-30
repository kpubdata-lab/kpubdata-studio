/**
 * Charts say what they cover (#500): every group, the top N after a sort, a cut result,
 * or a sample — and a cut result is never offered as the whole, the top N or a sample.
 */
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { mswServer } from "../vitest.setup";
import { AggregateChartPanel, aggregateRequest } from "@/features/charts/AggregateChartPanel";
import { coordinate, measureCandidates, toPoints } from "@/features/charts/chartData";
import { representsWhole, scopeOfAggregate, scopeOfQueryResult, type ChartScope } from "@/features/charts/chartScope";
import { CHART_SPEC_MAX_BYTES, parseChartSpec, type ChartSpec } from "@/features/charts/chartSpec";
import { SimpleChart } from "@/features/charts/SimpleChart";
import { ResultTable } from "@/features/sql/ResultTable";
import { API_BASE } from "@/shared/config/env";
import type { WarehouseAggregateResponse } from "@/shared/lib/builderApi";

// These talk to the Builder over HTTP (MSW); in mock mode the demo warehouse would answer (#530).
beforeEach(() => vi.stubEnv("VITE_USE_REAL_BUILDER", "true"));
afterEach(() => vi.unstubAllEnvs());

function aggregate(completeness: string, returned: number, groupCount: number, sampled = false): WarehouseAggregateResponse {
  return {
    snapshot: { table_id: "t", logical_name: "air", snapshot_id: "s1", revision: 1 },
    columns: ["station", "value"],
    column_meta: [
      { name: "station", logical_type: "string", wire_encoding: "string" },
      { name: "value", logical_type: "decimal", wire_encoding: "decimal_string" },
    ],
    rows: [
      { station: "b", value: "12.50" },
      { station: "a", value: null },
      { station: "c", value: "0" },
    ].slice(0, returned),
    group_by: ["station"],
    measures: [{ as: "value", fn: "sum", column: "pm10", additive: true, unit_column: null }],
    order: [{ key: "value", direction: "desc" }],
    unit: { column: null, policy: "reject", check: "not_checked" },
    input: { row_count: 900, sampled },
    result: { completeness, group_count: groupCount, returned, limit: 3 },
    execution_ms: 1,
    startup_ms: 0,
    engine_execution_ms: 1,
  };
}

const SCOPES: Array<[ChartScope, string, RegExp]> = [
  [{ kind: "full", count: 3 }, "full", /전체 — 3개 모두/],
  [{ kind: "top_n", returned: 3, total: 40, orderedBy: ["value desc"] }, "top_n", /상위 3개 — 전체 40개 그룹 중/],
  [{ kind: "truncated", returned: 500 }, "truncated", /반환된 500행 기준/],
  [{ kind: "sample", size: 100, method: "무작위" }, "sample", /표본 100개 \(무작위\)/],
];

describe("the three cases are told apart on screen (#500)", () => {
  it.each(SCOPES)("%o", (scope, kind, label) => {
    render(<SimpleChart kind="bar" points={[{ x: "a", y: 1, exact: "1" }]} scope={scope} xLabel="x" yLabel="y" />);
    const caption = screen.getByTestId("chart-scope");
    expect(caption).toHaveAttribute("data-scope", kind);
    expect(caption).toHaveTextContent(label);
  });

  it("a cut result is not called the top N, nor a sample, nor the whole", () => {
    render(<SimpleChart kind="bar" points={[]} scope={{ kind: "truncated", returned: 500 }} xLabel="x" yLabel="y" />);
    const text = screen.getByTestId("chart-scope").textContent ?? "";
    expect(text).toMatch(/전체도, 상위 N 도, 표본도 아닙니다/);
    expect(text).not.toMatch(/상위 500/);
    expect(representsWhole({ kind: "truncated", returned: 500 })).toBe(false);
  });
});

describe("scopes come from what the Builder said", () => {
  it("an aggregate is full or top N, and a sampled one is a sample", () => {
    expect(scopeOfAggregate(aggregate("full", 3, 3)).kind).toBe("full");
    expect(scopeOfAggregate(aggregate("top_n", 3, 40))).toEqual({ kind: "top_n", returned: 3, total: 40, orderedBy: ["value desc"] });
    expect(scopeOfAggregate(aggregate("full", 3, 3, true)).kind).toBe("sample");
    expect(scopeOfAggregate(aggregate("something_new", 3, 3)).kind).toBe("truncated");
  });

  it("a SQL result is whole unless it was cut", () => {
    expect(scopeOfQueryResult({ rows: [{}, {}], truncated: false })).toEqual({ kind: "full", count: 2 });
    expect(scopeOfQueryResult({ rows: [{}, {}], truncated: true })).toEqual({ kind: "truncated", returned: 2 });
  });

  it("charting a cut SQL result says so", () => {
    render(<ResultTable result={{ columns: ["d", "n"], rows: [{ d: "a", n: 1 }], truncated: true, execution_ms: 1 }} target="air@s1" />);
    fireEvent.click(screen.getByRole("button", { name: "차트로 보기" }));
    expect(screen.getByTestId("chart-scope")).toHaveAttribute("data-scope", "truncated");
  });
});

describe("points keep missing, zero and exact values apart (#500)", () => {
  it("missing is a gap, 0 is a point, and the Decimal text survives in the tooltip", () => {
    const { points } = toPoints(aggregate("full", 3, 3).rows, "station", "value", new Map([["value", "decimal_string" as const]]), "string");
    expect(points).toEqual([
      { x: "b", y: 12.5, exact: "12.50" },
      { x: "a", y: null, exact: "—" },
      { x: "c", y: 0, exact: "0" },
    ]);
    render(<SimpleChart kind="bar" points={points} scope={{ kind: "full", count: 3 }} xLabel="station" yLabel="sum" />);
    expect(document.querySelectorAll("rect")).toHaveLength(2);
    expect(document.querySelector("[data-missing]")).not.toBeNull();
    expect(screen.getByText(/값 없음 1개/)).toBeInTheDocument();
    expect([...document.querySelectorAll("title")].map((node) => node.textContent)).toContain("b: 12.50");
  });

  it("an unsafe integer is drawn approximately but read exactly", () => {
    const { points } = toPoints([{ k: "x", v: "9007199254740993" }], "k", "v", new Map([["v", "decimal_string" as const]]));
    expect(points[0].exact).toBe("9007199254740993");
    expect(coordinate("abc")).toBeNull();
  });

  it("a time axis is sorted by time and a line breaks at a gap", () => {
    const { points, temporal } = toPoints(
      [
        { d: "2026-03", v: 3 },
        { d: "2026-01", v: 1 },
        { d: "2026-02", v: null },
      ],
      "d",
      "v",
      new Map(),
    );
    expect(temporal).toBe(true);
    expect(points.map((point) => point.x)).toEqual(["2026-01", "2026-02", "2026-03"]);
    render(<SimpleChart kind="line" points={points} scope={{ kind: "full", count: 3 }} xLabel="d" yLabel="v" />);
    expect(document.querySelectorAll("polyline")).toHaveLength(2);
  });
});

describe("a stored ChartSpec is checked before use (#500)", () => {
  const spec: ChartSpec = { version: 1, table: "air", kind: "bar", groupBy: "station", measure: { fn: "count_rows" }, limit: 20 };

  it("accepts a well-formed spec for a readable table", () => {
    expect(parseChartSpec(JSON.stringify(spec), ["air"])).toEqual({ ok: true, spec });
  });

  it.each([
    [JSON.stringify({ ...spec, version: 2 }), "version"],
    [JSON.stringify({ ...spec, code: "fetch('x')" }), "shape"],
    [JSON.stringify(spec), "table", []],
    ["x".repeat(CHART_SPEC_MAX_BYTES + 1), "size"],
    [JSON.stringify({ ...spec, measure: { fn: "count_rows", column: { a: { b: { c: 1 } } } } }), "depth"],
    [JSON.stringify({ ...spec, measure: { fn: "sum" } }), "shape"],
  ] as Array<[string, string, string[]?]>)("refuses %#", (raw, reason, tables = ["air"]) => {
    expect(parseChartSpec(raw, tables)).toEqual({ ok: false, reason });
  });
});

describe("the aggregate panel asks Builder and shows what it covers", () => {
  it("bars sort by the value and a sum states it is additive", () => {
    const request = aggregateRequest({ version: 1, table: "air", kind: "bar", groupBy: "station", measure: { fn: "sum", column: "pm10", additive: true }, limit: 3 }, "current");
    expect(request.order_by).toEqual([{ key: "value", direction: "desc" }]);
    expect(request.measures[0]).toMatchObject({ fn: "sum", column: "pm10", additive: true });
  });

  it("draws a top-N aggregate and labels it as one", async () => {
    const bodies: unknown[] = [];
    mswServer.use(
      http.post(`${API_BASE}/warehouse/aggregate`, async ({ request }) => {
        bodies.push(await request.json());
        return HttpResponse.json(aggregate("top_n", 3, 40));
      }),
    );
    render(<AggregateChartPanel snapshot="current" table="air" />);
    fireEvent.change(screen.getByLabelText("그룹 열"), { target: { value: "station" } });
    fireEvent.click(screen.getByRole("button", { name: "그리기" }));
    await waitFor(() => expect(screen.getByTestId("chart-scope")).toHaveAttribute("data-scope", "top_n"));
    expect(bodies[0]).toMatchObject({ table: "air", snapshot: "current", group_by: ["station"], measures: [{ fn: "count_rows", as: "value" }] });
  });

  it("a sum is blocked until the person says the column is additive", () => {
    render(<AggregateChartPanel snapshot="current" table="air" />);
    fireEvent.change(screen.getByLabelText("그룹 열"), { target: { value: "station" } });
    fireEvent.change(screen.getByLabelText("측정"), { target: { value: "sum" } });
    fireEvent.change(screen.getByLabelText("측정 열"), { target: { value: "pm10" } });
    expect(screen.getByRole("button", { name: "그리기" })).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox"));
    expect(screen.getByRole("button", { name: "그리기" })).toBeEnabled();
  });
});

describe("an identifier column is text, never a measure (#582, builder#702)", () => {
  const CODE19 = "1234567890123456789";
  const result = {
    columns: ["bjd_code", "count", "note"],
    column_meta: [
      { name: "bjd_code", logical_type: "identifier", wire_encoding: "string" as const },
      { name: "count", logical_type: "int64", wire_encoding: "number" as const },
      { name: "note", logical_type: "some_future_type", wire_encoding: "string" as const },
    ],
    rows: [
      { bjd_code: "01234", count: 5, note: "007" },
      { bjd_code: CODE19, count: 7, note: "x" },
      { bjd_code: null, count: 2, note: null },
    ],
    truncated: false,
    execution_ms: 1,
  };

  it("is left out of the y candidates but offered as x", () => {
    expect(measureCandidates(result.columns, result.column_meta)).toEqual(["count", "note"]);
    render(<ResultTable result={result} target="air@s1" />);
    fireEvent.click(screen.getByRole("button", { name: "차트로 보기" }));
    const [xSelect, ySelect] = screen.getAllByRole("combobox");
    const options = (select: HTMLElement) => within(select).getAllByRole("option").map((option) => option.textContent);
    expect(options(xSelect)).toContain("bjd_code");
    expect(options(ySelect)).not.toContain("bjd_code");
    expect(ySelect).toHaveValue("count");
  });

  it("keeps a zero-led code, a 19-digit code and null as x labels, exactly", () => {
    render(<ResultTable result={result} target="air@s1" />);
    fireEvent.click(screen.getByRole("button", { name: "차트로 보기" }));
    const titles = [...document.querySelectorAll("title")].map((node) => node.textContent);
    expect(titles).toEqual(expect.arrayContaining(["01234: 5", `${CODE19}: 7`, "—: 2"]));
    // The table beside it shows the same text.
    expect(screen.getByRole("cell", { name: "01234" })).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: CODE19 })).toBeInTheDocument();
  });

  it("is never coerced to a number, even when handed in as y", () => {
    const encodings = new Map([["bjd_code", "string" as const]]);
    const { points, temporal } = toPoints(result.rows, "count", "bjd_code", encodings, "int64", "identifier");
    expect(points).toEqual([
      { x: "5", y: null, exact: "01234" },
      { x: "7", y: null, exact: CODE19 },
      { x: "2", y: null, exact: "—" },
    ]);
    expect(temporal).toBe(false);
    expect(coordinate("01234", "identifier")).toBeNull();
    expect(coordinate("01234")).toBe(1234);
  });

  it("an identifier x is never sorted as a time axis, even when its codes look like dates", () => {
    const { points, temporal } = toPoints(
      [
        { c: "2026-03", v: 1 },
        { c: "2026-01", v: 2 },
      ],
      "c",
      "v",
      new Map(),
      "identifier",
    );
    expect(temporal).toBe(false);
    expect(points.map((point) => point.x)).toEqual(["2026-03", "2026-01"]);
  });

  it("says so when no column can be a measure", () => {
    render(
      <ResultTable
        result={{ ...result, columns: ["bjd_code"], rows: [{ bjd_code: "01234" }] }}
        target="air@s1"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "차트로 보기" }));
    expect(screen.getByText(/숫자로 그릴 수 있는 열이 없습니다/)).toBeInTheDocument();
    expect(screen.queryByTestId("chart-scope")).toBeNull();
  });
});
