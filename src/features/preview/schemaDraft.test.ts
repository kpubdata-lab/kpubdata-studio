/**
 * Schema-contract draft generation regression tests (VAL-4, #227).
 *
 * Verifies required/dtypes/key candidates are deterministically derived from
 * the /preview column schema without an LLM.
 */
import { describe, expect, it } from "vitest";

import type { PreviewColumn } from "@/shared/lib/builderApi.schema";

import { draftSchemaContract } from "./schemaDraft";

const col = (
  name: string,
  dtype: string,
  nullable: boolean,
  uniqueCount: number,
): PreviewColumn => ({
  name,
  dtype,
  nullable,
  unique_count: uniqueCount,
});

describe("draftSchemaContract — required/dtypes 도출 (#227)", () => {
  it("nullable=false 컬럼을 required로, 모든 dtype을 dtypes로", () => {
    const draft = draftSchemaContract(
      [col("a", "int64", false, 2), col("b", "string", true, 1)],
      2,
    );
    expect(draft.contract.required).toEqual(["a"]);
    expect(draft.contract.dtypes).toEqual({ a: "int64", b: "string" });
    expect(draft.contract.casts).toEqual({});
  });

  it("모두 nullable이면 required 빈 배열", () => {
    const draft = draftSchemaContract([col("a", "int64", true, 1)], 1);
    expect(draft.contract.required).toEqual([]);
  });
});

describe("draftSchemaContract — 키 후보 (#227)", () => {
  it("unique_count == row_count인 컬럼을 키 후보로", () => {
    const draft = draftSchemaContract(
      [col("id", "int64", false, 3), col("v", "int64", false, 1)],
      3,
    );
    expect(draft.keyCandidates).toEqual(["id"]);
  });

  it("row_count 0이면 키 후보 없음", () => {
    const draft = draftSchemaContract([col("id", "int64", false, 0)], 0);
    expect(draft.keyCandidates).toEqual([]);
  });
});

describe("draftSchemaContract — 한계 경고 (#227)", () => {
  it("행이 있으면 '조회 범위 기준' 경고", () => {
    const draft = draftSchemaContract([col("a", "int64", false, 1)], 1);
    expect(draft.warnings.some((w) => w.includes("조회 범위"))).toBe(true);
  });

  it("행이 0건이면 무의미 경고", () => {
    const draft = draftSchemaContract([col("a", "int64", false, 0)], 0);
    expect(draft.warnings.some((w) => w.includes("0건"))).toBe(true);
  });
});
