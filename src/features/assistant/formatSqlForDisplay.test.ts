import { describe, expect, it } from "vitest";
import { formatSqlForDisplay } from "./formatSqlForDisplay";

describe("formatSqlForDisplay", () => {
  it("breaks major top-level clauses while keeping a short projection together", () => {
    const raw = "SELECT a, b FROM dataset WHERE a > 0 ORDER BY b DESC";
    expect(formatSqlForDisplay(raw)).toBe("SELECT a, b\nFROM dataset\nWHERE a > 0\nORDER BY b DESC");
    expect(raw).toBe("SELECT a, b FROM dataset WHERE a > 0 ORDER BY b DESC");
  });

  it("does not treat clause words inside quoted strings as syntax", () => {
    expect(formatSqlForDisplay("SELECT 'FROM WHERE' AS note FROM dataset")).toBe(
      "SELECT 'FROM WHERE' AS note\nFROM dataset",
    );
  });

  it("only breaks top-level clauses around a nested subquery", () => {
    const raw = "SELECT x FROM (SELECT x FROM source WHERE x > 0) nested WHERE x < 10";
    expect(formatSqlForDisplay(raw)).toBe(
      "SELECT x\nFROM (SELECT x FROM source WHERE x > 0) nested\nWHERE x < 10",
    );
  });

  it("falls back to raw SQL when the input is incomplete", () => {
    const raw = "SELECT x FROM (SELECT 'WHERE' FROM dataset";
    expect(formatSqlForDisplay(raw)).toBe(raw);
  });
});
