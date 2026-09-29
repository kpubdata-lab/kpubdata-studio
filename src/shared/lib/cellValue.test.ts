import { describe, expect, it } from "vitest";

import { cellValue, encodingsOf } from "./cellValue";

const FIRST_UNSAFE = "9007199254740993";

describe("cellValue (#484)", () => {
  it("keeps exact decimal text exactly", () => {
    expect(cellValue("decimal_string", FIRST_UNSAFE)).toBe(FIRST_UNSAFE);
    expect(cellValue("decimal_string", "0.10")).toBe("0.10");
    // What Number() would have done — the reason this helper exists.
    expect(String(Number(FIRST_UNSAFE))).not.toBe(FIRST_UNSAFE);
  });

  it("shows missing as a dash, JSON as JSON, the rest as text", () => {
    expect(cellValue("number", null)).toBe("—");
    expect(cellValue(undefined, undefined)).toBe("—");
    expect(cellValue("json", { a: 1 })).toBe('{"a":1}');
    expect(cellValue("boolean", false)).toBe("false");
    expect(cellValue("number", 3)).toBe("3");
  });

  it("reads each response's encodings, ignoring columns that do not say", () => {
    const map = encodingsOf([
      { name: "id", wire_encoding: "decimal_string" },
      { name: "legacy" },
    ]);
    expect(map.get("id")).toBe("decimal_string");
    expect(map.has("legacy")).toBe(false);
    expect(encodingsOf(undefined).size).toBe(0);
  });
});
