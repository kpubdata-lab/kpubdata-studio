/**
 * Values are drawn by what their column holds (#844).
 *
 * Every cell was one truncated run of text: a count sat against the left edge with no
 * separators, a date as sent, an address that could not be followed, a long text that
 * could only be cut. What a value is comes from the column's logical type as Builder
 * sent it, and no digit is changed on the way (#484).
 */
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { cellDisplay, digitGroups, readableMoment } from "@/shared/lib/cellValue";
import { DataTable } from "./DataTable";
import { LONG_TEXT, TypedCell } from "./TypedCell";

describe("digitGroups", () => {
  it.each([
    ["1234567", ["1", "234", "567"], ""],
    ["-1234567.50", ["1", "234", "567"], ".50"],
    ["12345", ["12", "345"], ""],
    ["123456", ["123", "456"], ""],
    // Every digit of an integer beyond 2^53 and of an exact decimal is kept.
    ["9007199254740993", ["9", "007", "199", "254", "740", "993"], ""],
    ["123456789012345678.123456789012345678", ["123", "456", "789", "012", "345", "678"], ".123456789012345678"],
  ])("cuts %s into %j", (sent, groups, fraction) => {
    const cut = digitGroups(sent);

    expect(cut?.groups).toEqual(groups);
    expect(cut?.fraction).toBe(fraction);
    // Joined again it is what was sent: nothing was parsed, rounded or dropped.
    expect(`${cut?.sign}${cut?.groups.join("")}${cut?.fraction}`).toBe(sent);
  });

  it.each(["2024", "999", "-1234", "0", "0.000125"])("leaves %s, of four digits or fewer, in one group", (sent) => {
    expect(digitGroups(sent)?.groups).toHaveLength(1);
  });

  it.each(["1e+21", "NaN", "inf", "12,345", "1 234", "", "0x1F", "12.", ".5"])("does not take %s for a plain decimal", (sent) => {
    expect(digitGroups(sent)).toBeNull();
  });
});

describe("readableMoment", () => {
  it.each([
    ["2026-09-08", "2026-09-08"],
    ["2026-09-08T13:05:00", "2026-09-08 13:05"],
    ["2026-09-08 13:05:00.000000", "2026-09-08 13:05"],
    ["2026-09-08T13:05:09", "2026-09-08 13:05:09"],
    ["2026-09-08T13:05:09.250000", "2026-09-08 13:05:09.25"],
    ["2026-09-08T13:05:00Z", "2026-09-08 13:05 UTC"],
    ["2026-09-08T13:05:00+09:00", "2026-09-08 13:05 +09:00"],
  ])("reads %s as %s", (sent, shown) => {
    expect(readableMoment(sent)).toBe(shown);
  });

  it.each(["24.01.25", "2026-09-08 24:00 KST", "20260908", "어제", ""])("leaves %s, which is not ISO, as it was sent", (sent) => {
    expect(readableMoment(sent)).toBe(sent);
  });

  it("applies no time zone: the hour sent is the hour shown", () => {
    // A moment parsed and printed in this machine's zone would move.
    expect(readableMoment("2026-01-01T00:30:00+09:00")).toBe("2026-01-01 00:30 +09:00");
  });
});

describe("cellDisplay", () => {
  it.each(["int64", "int8", "uint32", "float64", "decimal"])("takes a %s column for numbers", (type) => {
    expect(cellDisplay("number", type, 1234567)).toStrictEqual({
      kind: "number",
      text: "1234567",
      digits: { sign: "", groups: ["1", "234", "567"], fraction: "" },
    });
  });

  it("groups exact decimal text without parsing it", () => {
    expect(cellDisplay("decimal_string", "decimal", "9007199254740993.10")).toStrictEqual({
      kind: "number",
      text: "9007199254740993.10",
      digits: { sign: "", groups: ["9", "007", "199", "254", "740", "993"], fraction: ".10" },
    });
    // A number that is not a plain decimal is shown as sent, still as a number.
    expect(cellDisplay("number", "float64", 1e21)).toStrictEqual({ kind: "number", text: "1e+21" });
  });

  it.each([
    ["a code", "identifier", "0012345678"],
    ["text that is all digits", "string", "1234567"],
    ["a column of no stated type", undefined, "1234567"],
    ["a type this Studio does not know", "geometry", "1234567"],
  ])("does not take %s for a number", (_what, type, value) => {
    expect(cellDisplay("string", type, value)).toStrictEqual({ kind: "text", text: value });
  });

  it.each(["code", "period", "date", "flag", "text", "a-kind-of-a-later-builder"])(
    "does not draw a numeric column whose values are a %s as quantities",
    (kind) => {
      // A legal-dong code kept as an integer, a 202410: digits, not an amount.
      expect(cellDisplay("number", "int64", 1111010100, kind)).toStrictEqual({ kind: "text", text: "1111010100" });
    },
  );

  it("draws a numeric column said to be a measure, or said nothing of, as quantities", () => {
    expect(cellDisplay("number", "int64", 1111010100, "measure").kind).toBe("number");
    expect(cellDisplay("number", "int64", 1111010100).kind).toBe("number");
    expect(cellDisplay("number", "int64", 1111010100, undefined).digits?.groups).toEqual(["1", "111", "010", "100"]);
  });

  it("reads a date column, and leaves a text column that looks like a date alone", () => {
    expect(cellDisplay("string", "datetime", "2026-09-08T13:05:00")).toStrictEqual({ kind: "date", text: "2026-09-08 13:05" });
    expect(cellDisplay("string", "date", "2026-09-08")).toStrictEqual({ kind: "date", text: "2026-09-08" });
    expect(cellDisplay("string", "string", "2026-09-08T13:05:00")).toStrictEqual({ kind: "text", text: "2026-09-08T13:05:00" });
  });

  it("makes a link of a value that is one web address, and of nothing else", () => {
    expect(cellDisplay("string", "string", "https://www.data.go.kr/data/15073861/openapi.do")).toStrictEqual({
      kind: "link",
      text: "https://www.data.go.kr/data/15073861/openapi.do",
      href: "https://www.data.go.kr/data/15073861/openapi.do",
    });
    for (const notOne of ["javascript:alert(1)", "see https://example.org", "https://a.example and more", "ftp://example.org/x", "data:text/html,x"]) {
      expect(cellDisplay("string", "string", notOne).kind, notOne).toBe("text");
    }
    // A code is text even when it is an address.
    expect(cellDisplay("string", "identifier", "https://example.org/id/1").kind).toBe("text");
  });

  it("shows a missing value as a dash, and a nested one as its JSON", () => {
    expect(cellDisplay("number", "int64", null)).toStrictEqual({ kind: "missing", text: "—" });
    expect(cellDisplay("string", "string", undefined)).toStrictEqual({ kind: "missing", text: "—" });
    expect(cellDisplay(undefined, "struct", { a: 1 })).toStrictEqual({ kind: "text", text: '{"a":1}' });
    expect(cellDisplay("number", "int64", [1, 2])).toStrictEqual({ kind: "text", text: "[1,2]" });
  });

  it("shows zero and false as values, not as missing", () => {
    expect(cellDisplay("number", "int64", 0)).toMatchObject({ kind: "number", text: "0" });
    expect(cellDisplay(undefined, "boolean", false)).toStrictEqual({ kind: "text", text: "false" });
  });
});

describe("TypedCell", () => {
  it("opens a link elsewhere and passes nothing on to it", () => {
    render(<TypedCell column="note" encoding="string" logicalType="string" value="https://example.org/a" />);

    // Its name says where it goes and that it opens elsewhere.
    const link = screen.getByRole("link", { name: /^https:\/\/example\.org\/a.*새 탭에서 열림/ });
    expect(link).toHaveAttribute("href", "https://example.org/a");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("opens a long text in place and closes it again", () => {
    const long = "가".repeat(LONG_TEXT + 1);
    render(<TypedCell column="note" encoding="string" logicalType="string" value={long} />);

    // Named by its column: a page has one such control in every long cell.
    const control = screen.getByRole("button", { name: "note 값 펼치기" });
    expect(control).toHaveAttribute("aria-expanded", "false");
    expect(control).toHaveTextContent("펼치기");
    // All of it is in the page either way: cut by the layout, not by the text.
    expect(screen.getByText(long)).toBeInTheDocument();
    fireEvent.click(control);
    expect(screen.getByRole("button", { name: "note 값 접기" })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText(long).className).toContain("whitespace-pre-wrap");
    fireEvent.click(screen.getByRole("button", { name: "note 값 접기" }));
    expect(screen.getByRole("button", { name: "note 값 펼치기" })).toBeInTheDocument();
  });

  it("draws a number's digits in threes without writing a separator into its text", () => {
    const { container } = render(<TypedCell column="note" encoding="decimal_string" logicalType="decimal" value="-9007199254740993.10" />);

    // What is read, searched and copied is what Builder sent.
    expect(container.textContent).toBe("-9007199254740993.10");
    const groups = [...container.querySelectorAll("[data-digit-group]")];
    expect(groups.map((group) => group.textContent)).toEqual(["9", "007", "199", "254", "740", "993"]);
    // The comma is generated content, before every group but the first.
    expect(groups.map((group) => group.className.includes("before:content-[',']"))).toEqual([false, true, true, true, true, true]);
  });

  it("does not leave a cell open for the value that takes its place", () => {
    // A table page is drawn into the same rows as the one before it.
    const first = "가".repeat(LONG_TEXT + 1);
    const { rerender } = render(<TypedCell column="note" encoding="string" logicalType="string" value={first} />);
    fireEvent.click(screen.getByRole("button", { name: "note 값 펼치기" }));

    rerender(<TypedCell column="note" encoding="string" logicalType="string" value={"나".repeat(LONG_TEXT + 1)} />);

    expect(screen.getByRole("button", { name: "note 값 펼치기" })).toHaveAttribute("aria-expanded", "false");
  });

  it("keeps a short text on one line", () => {
    render(<TypedCell column="note" encoding="string" logicalType="string" value="서울특별시 강남구 테헤란로" />);

    expect(screen.getByText("서울특별시 강남구 테헤란로").className).toContain("truncate");
  });

  it("gives a short text no control", () => {
    render(<TypedCell column="note" encoding="string" logicalType="string" value={"나".repeat(LONG_TEXT)} />);

    expect(screen.queryByRole("button")).toBeNull();
  });
});

describe("DataTable", () => {
  const columns = ["station", "pm10", "measured_at", "source_url", "code"];
  const columnMeta = [
    { name: "station", logical_type: "string", wire_encoding: "string" as const },
    { name: "pm10", logical_type: "int64", wire_encoding: "number" as const },
    { name: "measured_at", logical_type: "datetime", wire_encoding: "string" as const },
    { name: "source_url", logical_type: "string", wire_encoding: "string" as const },
    { name: "code", logical_type: "identifier", wire_encoding: "string" as const },
  ];
  const rows = [
    { station: "강남구", pm10: 1234567, measured_at: "2026-09-08T13:00:00", source_url: "https://example.org/1", code: "0011100" },
    { station: "서초구", pm10: null, measured_at: null, source_url: null, code: "0011200" },
  ];

  function renderTable() {
    render(<DataTable columnMeta={columnMeta} columns={columns} rowTotal={{ returned: 2, total: 2, status: "exact" }} rows={rows} />);
    const [, first, second] = screen.getAllByRole("row");
    return { first: within(first).getAllByRole("cell"), second: within(second).getAllByRole("cell") };
  }

  it("draws each column by its type", () => {
    const { first } = renderTable();

    expect(first[0]).toHaveTextContent("강남구");
    expect(first[1].textContent).toBe("1234567");
    expect(first[1].querySelectorAll("[data-digit-group]")).toHaveLength(3);
    expect(first[2]).toHaveTextContent("2026-09-08 13:00");
    expect(within(first[3]).getByRole("link")).toHaveAttribute("href", "https://example.org/1");
    // A code keeps its leading zeros and gets no separators.
    expect(first[4]).toHaveTextContent("0011100");
  });

  it("puts a number column against the right edge, header and cells, and no other", () => {
    const { first } = renderTable();
    const headers = screen.getAllByRole("columnheader");

    expect(first[1].className).toContain("text-right");
    expect(headers[1].className).toContain("text-right");
    for (const index of [0, 2, 3, 4]) {
      expect(first[index].className, columns[index]).not.toContain("text-right");
      expect(headers[index].className, columns[index]).not.toContain("text-right");
    }
  });

  it("shows a missing value as a dash in every kind of column", () => {
    const { second } = renderTable();

    for (const index of [1, 2, 3]) expect(second[index], columns[index]).toHaveTextContent("—");
  });

  it("leaves a numeric column of codes against the left edge, ungrouped", () => {
    render(
      <DataTable
        columnMeta={[
          { name: "dong", logical_type: "int64", wire_encoding: "number" as const, semantic: { kind: "code", origin: "kpubdata_spec" } },
          { name: "count", logical_type: "int64", wire_encoding: "number" as const, semantic: { kind: "measure", origin: "kpubdata_spec" } },
        ]}
        columns={["dong", "count"]}
        rowTotal={{ returned: 1, total: 1, status: "exact" }}
        rows={[{ dong: 1111010100, count: 1111010100 }]}
      />,
    );
    const [dong, count] = within(screen.getAllByRole("row")[1]).getAllByRole("cell");

    expect(dong.querySelectorAll("[data-digit-group]")).toHaveLength(0);
    expect(dong.className).not.toContain("text-right");
    expect(count.querySelectorAll("[data-digit-group]")).toHaveLength(4);
    expect(count.className).toContain("text-right");
  });

  it("draws a column Builder described nothing of as the text it was sent", () => {
    render(<DataTable columns={["n"]} rowTotal={{ returned: 1, total: null, status: "sample" }} rows={[{ n: 1234567 }]} />);

    const cell = within(screen.getAllByRole("row")[1]).getByRole("cell");
    expect(cell).toHaveTextContent("1234567");
    expect(cell.className).not.toContain("text-right");
  });
});
