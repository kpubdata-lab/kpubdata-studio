/**
 * Builder responses may grow; Studio's parsing must not break when they do (#497).
 *
 * Nineteen response schemas used to be `.strict()`, so one optional field added by the
 * Builder failed a whole screen (builder#735 needed Studio to ship first for exactly that
 * reason), and `wire_encoding` was a closed enum, so one new encoding failed the whole
 * response. This file is the gate:
 *
 * 1. Structural: no object reachable from any exported `*ResponseSchema` rejects unknown
 *    keys, except the ones listed in STRICT_ON_PURPOSE with the reason.
 * 2. Fixtures: the schemas the issue named accept a payload with extra fields at the top
 *    and nested levels, strip those fields, and still reject a missing or mistyped
 *    required field.
 * 3. Requests stay strict.
 * 4. An unknown `wire_encoding` parses as "unsupported" and the cell says so.
 *
 * Payloads are written by hand; builder#814 (contract fixtures) will replace them.
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { z } from "zod";

import { ResultTable } from "@/features/sql/ResultTable";
import * as schemas from "@/shared/lib/builderApi.schema";
import { cellValue } from "@/shared/lib/cellValue";

/**
 * Response schemas allowed to reject unknown keys, and why. Adding a name here is a
 * decision a reviewer should see.
 */
const STRICT_ON_PURPOSE: Record<string, string> = {
  providerCredentialResponseSchema:
    "answers what Studio holds for a secret; an extra field may be a leaked secret and must fail loudly",
};

type Def = {
  type: string;
  shape?: Record<string, z.ZodType>;
  catchall?: z.ZodType;
  element?: z.ZodType;
  innerType?: z.ZodType;
  options?: z.ZodType[];
  valueType?: z.ZodType;
  in?: z.ZodType;
  out?: z.ZodType;
  left?: z.ZodType;
  right?: z.ZodType;
};

const defOf = (schema: z.ZodType) => (schema as unknown as { def: Def }).def;

/** Paths of every object under `schema` that rejects unknown keys. */
function strictObjects(schema: z.ZodType, path: string, seen = new Set<z.ZodType>()): string[] {
  if (seen.has(schema)) return [];
  seen.add(schema);
  const def = defOf(schema);
  const found: string[] = [];
  const visit = (child: z.ZodType | undefined, childPath: string) => {
    if (child) found.push(...strictObjects(child, childPath, seen));
  };
  if (def.type === "object") {
    if (def.catchall && defOf(def.catchall).type === "never") found.push(path);
    for (const [key, field] of Object.entries(def.shape ?? {})) visit(field, `${path}.${key}`);
  }
  visit(def.element, `${path}[]`);
  visit(def.innerType, path);
  visit(def.valueType, `${path}{}`);
  visit(def.in, path);
  visit(def.out, path);
  visit(def.left, path);
  visit(def.right, path);
  for (const option of def.options ?? []) visit(option, `${path}|`);
  return found;
}

const responseSchemas = Object.entries(schemas as unknown as Record<string, unknown>)
  .filter(([name, value]) => name.endsWith("ResponseSchema") && typeof value === "object" && value !== null)
  .map(([name, value]) => [name, value as z.ZodType] as const);

describe("response schemas tolerate additive fields — structural gate (#497)", () => {
  it("finds the response schemas (a rename must not make this pass on nothing)", () => {
    expect(responseSchemas.length).toBeGreaterThan(40);
  });

  it.each(responseSchemas)("%s rejects no unknown key", (name, schema) => {
    const strict = strictObjects(schema, name);
    if (name in STRICT_ON_PURPOSE) {
      expect(strict, `${name} is listed as strict on purpose but is not strict`).toContain(name);
      return;
    }
    expect(strict).toEqual([]);
  });
});

/** Adds an unknown key to the top level and to every nested plain object and array item. */
function withExtras(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withExtras);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, inner] of Object.entries(value)) out[key] = withExtras(inner);
    out.engine_added_later = { nested: true };
    return out;
  }
  return value;
}

/**
 * `withExtras` for a whole payload. `freeForm` values (sample rows, counts) are data and
 * left alone; `records` values are maps keyed by data (source key → items), so their
 * items get extras but the map itself gets no extra key.
 */
function withExtrasTopAndItems(
  value: Record<string, unknown>,
  freeForm: string[],
  records: string[],
): Record<string, unknown> {
  const out: Record<string, unknown> = { engine_added_later: "x" };
  for (const [key, inner] of Object.entries(value)) {
    if (freeForm.includes(key)) out[key] = inner;
    else if (records.includes(key) && inner && typeof inner === "object") {
      out[key] = Object.fromEntries(Object.entries(inner).map(([k, v]) => [k, withExtras(v)]));
    } else out[key] = withExtras(inner);
  }
  return out;
}

function hasKeyDeep(value: unknown, key: string): boolean {
  if (Array.isArray(value)) return value.some((item) => hasKeyDeep(item, key));
  if (value && typeof value === "object") {
    return Object.entries(value).some(([k, inner]) => k === key || hasKeyDeep(inner, key));
  }
  return false;
}

type Fixture = {
  schema: z.ZodType;
  payload: Record<string, unknown>;
  /** Keys whose value is a data map (sample rows, counts) — extras there would be data. */
  freeForm?: string[];
  /** Keys whose value is a map keyed by data (source key → items). */
  records?: string[];
  missing: string;
  mistyped: [string, unknown];
};

const FIXTURES: Record<string, Fixture> = {
  bronzeStageDetailResponseSchema: {
    schema: schemas.bronzeStageDetailResponseSchema,
    payload: {
      run_id: "r1",
      source_key: "datago__air",
      status: "completed",
      available: true,
      stage: "bronze",
      provider: "datago",
      dataset: "air",
      fetched_at: "2026-09-29T00:00:00Z",
      record_count: 3,
    },
    missing: "record_count",
    mistyped: ["available", "yes"],
  },
  silverStageDetailResponseSchema: {
    schema: schemas.silverStageDetailResponseSchema,
    payload: {
      run_id: "r1",
      source_key: "datago__air",
      status: "completed",
      available: true,
      stage: "silver",
      row_count: 1,
      schema: [{ name: "pm10", dtype: "float64", nullable: false, unique_count: 1 }],
      statistics: { row_count: 1, null_counts: { pm10: 0 }, duplicate_rate: 0 },
      validation: { ok: true, problems: [{ code: "c", field: null, message: "m" }] },
      sample: [{ pm10: 1.5 }],
    },
    freeForm: ["sample", "statistics"],
    missing: "schema",
    mistyped: ["row_count", "1"],
  },
  goldStageDetailResponseSchema: {
    schema: schemas.goldStageDetailResponseSchema,
    payload: {
      run_id: "r1",
      source_key: "datago__air",
      status: "completed",
      available: true,
      stage: "gold",
      row_count: 1,
      columns: ["pm10"],
      splits: null,
      exports: [{ kind: "jsonl" }],
      sample: null,
      sample_available: false,
    },
    missing: "columns",
    mistyped: ["exports", "jsonl"],
  },
  buildQualityResponseSchema: {
    schema: schemas.buildQualityResponseSchema,
    payload: {
      run_id: "r1",
      availability: "available",
      evaluated_checks: 1,
      quality_results: {
        datago__air: [
          {
            source_key: "datago__air",
            category: "completeness",
            rule: "not_null",
            column: "pm10",
            status: "pass",
            actual: 0,
            threshold: 0,
            affected_rows: 0,
            evaluated_rows: 1,
            detail: null,
          },
        ],
      },
      schema_drift: { datago__air: [{ kind: "column_added", column: "pm25", detail: "new" }] },
    },
    records: ["quality_results", "schema_drift"],
    missing: "schema_drift",
    mistyped: ["evaluated_checks", "one"],
  },
  publishReadinessResponseSchema: {
    schema: schemas.publishReadinessResponseSchema,
    payload: {
      run_id: "r1",
      target: "huggingface",
      ready: false,
      blockers: [{ code: "no_license", message: "License missing" }],
      warnings: [],
    },
    missing: "ready",
    mistyped: ["blockers", "none"],
  },
  publishResponseSchema: {
    schema: schemas.publishResponseSchema,
    payload: {
      run_id: "r1",
      target: "huggingface",
      publisher: "hf",
      destination: "org/air",
      reference: "abc",
      artifact_count: 2,
      status: "published",
    },
    missing: "reference",
    mistyped: ["artifact_count", -1],
  },
  publishBlockedResponseSchema: {
    schema: schemas.publishBlockedResponseSchema,
    payload: { error: "blocked", blockers: [{ code: "no_license", message: "License missing" }] },
    missing: "blockers",
    mistyped: ["error", 1],
  },
  adminConfigResponseSchema: {
    schema: schemas.adminConfigResponseSchema,
    payload: { enforce_ownership: true, publish_server_credential_fallback: false },
    missing: "enforce_ownership",
    mistyped: ["publish_server_credential_fallback", "false"],
  },
  adminRunsResponseSchema: {
    schema: schemas.adminRunsResponseSchema,
    payload: { runs: [{ run_id: "r1", status: "ok", owner_id: "h1" }], count: 1 },
    missing: "count",
    mistyped: ["runs", {}],
  },
};

describe("response fixtures with additive fields (#497)", () => {
  describe.each(Object.entries(FIXTURES))("%s", (_name, fixture) => {
    it("accepts the plain payload", () => {
      const parsed = fixture.schema.safeParse(fixture.payload);
      expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
    });

    it("accepts extra fields at every level and strips them", () => {
      const parsed = fixture.schema.safeParse(withExtrasTopAndItems(fixture.payload, fixture.freeForm ?? [], fixture.records ?? []));
      expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
      // Stripped, not passed through: nothing Studio does not model reaches a component.
      expect(hasKeyDeep(parsed.data, "engine_added_later")).toBe(false);
      expect(parsed.data).toEqual(fixture.schema.parse(fixture.payload));
    });

    it("still rejects a missing required field", () => {
      const payload = { ...fixture.payload };
      delete payload[fixture.missing];
      expect(fixture.schema.safeParse(payload).success).toBe(false);
    });

    it("still rejects a mistyped required field", () => {
      const [key, bad] = fixture.mistyped;
      expect(fixture.schema.safeParse({ ...fixture.payload, [key]: bad }).success).toBe(false);
    });
  });
});

describe("what stays strict (#497)", () => {
  it("the credential response rejects an extra field", () => {
    const payload = { configured: true, masked: "ab••••yz", updated_at: null };
    expect(schemas.providerCredentialResponseSchema.safeParse(payload).success).toBe(true);
    expect(schemas.providerCredentialResponseSchema.safeParse({ ...payload, secret: "raw" }).success).toBe(false);
  });

  it("a request Studio sends rejects an unknown key", () => {
    const request = { target: "huggingface", destination: "org/air" };
    expect(schemas.publishRequestSchema.safeParse(request).success).toBe(true);
    expect(schemas.publishRequestSchema.safeParse({ ...request, typo: 1 }).success).toBe(false);
    expect(
      schemas.publishRequestSchema.safeParse({ ...request, options: { private: true, typo: 1 } }).success,
    ).toBe(false);
  });
});

describe("extensible wire_encoding (#497)", () => {
  const column = { name: "amount", dtype: "Decimal", nullable: false, unique_count: 1, logical_type: "decimal" };

  it("parses an unknown encoding as unsupported instead of failing the response", () => {
    const parsed = schemas.silverColumnInfoSchema.safeParse({ ...column, wire_encoding: "decimal128_v2" });
    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
    expect(parsed.data?.wire_encoding).toBe("unsupported");
  });

  it("keeps known encodings as they are", () => {
    expect(schemas.silverColumnInfoSchema.parse({ ...column, wire_encoding: "decimal_string" }).wire_encoding).toBe(
      "decimal_string",
    );
  });

  it("still rejects a non-string encoding", () => {
    expect(schemas.silverColumnInfoSchema.safeParse({ ...column, wire_encoding: 3 }).success).toBe(false);
  });

  it("does not guess a value for an unsupported column", () => {
    expect(cellValue("unsupported", "12345678901234567890")).toBe("지원하지 않는 형식");
    expect(cellValue("unsupported", 1.5)).toBe("지원하지 않는 형식");
    // Missing stays missing.
    expect(cellValue("unsupported", null)).toBe("—");
  });

  it("shows an unsupported cell in a query result table", () => {
    const result = schemas.queryResponseSchema.parse({
      columns: ["id", "amount"],
      column_meta: [
        { name: "id", logical_type: "int64", wire_encoding: "number" },
        { name: "amount", logical_type: "decimal256", wire_encoding: "decimal128_v2" },
      ],
      rows: [{ id: 1, amount: "12345678901234567890.123" }],
      truncated: false,
      execution_ms: 1,
    });
    render(<ResultTable result={result} target="air@r1" />);
    expect(screen.getByText("지원하지 않는 형식")).toBeInTheDocument();
    expect(screen.queryByText("12345678901234567890.123")).not.toBeInTheDocument();
    expect(screen.getByText("1")).toBeInTheDocument();
  });
});
