import { describe, expect, it } from "vitest";
import {
  previewColumnSchema,
  queryResponseSchema,
  silverStageDetailResponseSchema,
} from "./builderApi.schema";

// builder#735: Builder 1.30.0 sends Decimals and out-of-range integers as exact decimal
// text and says so per column. Studio must accept the new fields and keep the text as text.
const FIRST_UNSAFE = "9007199254740993";

describe("wire encoding (builder#735)", () => {
  it("keeps a decimal_string query column as exact text", () => {
    const parsed = queryResponseSchema.parse({
      columns: ["id", "amount", "count"],
      column_meta: [
        { name: "id", logical_type: "int64", wire_encoding: "decimal_string" },
        { name: "amount", logical_type: "decimal", wire_encoding: "decimal_string" },
        { name: "count", logical_type: "int64", wire_encoding: "number" },
      ],
      rows: [{ id: FIRST_UNSAFE, amount: "0.10", count: 3 }],
      truncated: false,
      execution_ms: 1,
    });

    expect(parsed.rows[0]).toEqual({ id: FIRST_UNSAFE, amount: "0.10", count: 3 });
    expect(parsed.column_meta?.[0].wire_encoding).toBe("decimal_string");
  });

  it("shows why the text matters: the same value as a JSON number is already wrong", () => {
    expect(String(JSON.parse(FIRST_UNSAFE))).not.toBe(FIRST_UNSAFE);
    expect(JSON.parse(`"${FIRST_UNSAFE}"`)).toBe(FIRST_UNSAFE);
  });

  it("accepts a 1.30.0 silver stage detail", () => {
    const detail = {
      run_id: "r1",
      stage: "silver",
      source_key: "datago__air",
      status: "completed",
      available: true,
      row_count: 1,
      schema: [
        {
          name: "id",
          dtype: "Int64",
          nullable: false,
          unique_count: 1,
          logical_type: "int64",
          wire_encoding: "decimal_string",
        },
      ],
      statistics: null,
      validation: null,
      sample: [{ id: FIRST_UNSAFE }],
    };

    const parsed = silverStageDetailResponseSchema.safeParse(detail);
    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
    expect(parsed.data?.sample[0]).toEqual({ id: FIRST_UNSAFE });
  });

  it("still accepts a pre-1.30.0 Builder that sends no wire fields", () => {
    expect(previewColumnSchema.parse({ name: "v", dtype: "Int64", nullable: false, unique_count: 1 })).toEqual({
      name: "v",
      dtype: "Int64",
      nullable: false,
      unique_count: 1,
    });
    expect(queryResponseSchema.parse({ columns: [], rows: [], truncated: false, execution_ms: 0 }).column_meta).toBeUndefined();
  });

  it("reads a wire encoding outside the known enum as unsupported, not as a failure (#497)", () => {
    const column = { name: "v", dtype: "Int64", nullable: false, unique_count: 1 };
    expect(previewColumnSchema.parse({ ...column, wire_encoding: "bigint" }).wire_encoding).toBe("unsupported");
    // A non-string is still a type error.
    expect(() => previewColumnSchema.parse({ ...column, wire_encoding: 7 })).toThrow();
  });
});
