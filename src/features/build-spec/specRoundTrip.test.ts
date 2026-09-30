/**
 * Source-level contract fields survive every spec round trip (#601).
 *
 * Builder `SourceRef` (contract 1.64.0) carries `param_grid`, `gold` (select/filters/
 * pii_columns/publish_unmasked) and a loose `schema`; Studio does not edit them, so YAML ↔
 * form ↔ BuildSpec (and Zod parsing, draft save/restore, spec store) must hand them back
 * unchanged while the form's own edits still win.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";
import { fromYamlText, toYamlText } from "./yamlText";
import { fromBuilderSpec, serializeSpec, toBuilderSpec, type BuilderSpec } from "./specMapping";
import { toBuildSpec, toFormValues } from "./newBuildModel";
import { loadBuildSpec, saveBuildSpec } from "./specStore";
import { applyBuildSpecToDraft, buildSpecFromDraft, INITIAL_DRAFT } from "@/features/add-data/model";
import { loadAddDataDraft, saveAddDataDraft } from "@/features/add-data/draftStorage";
import { buildSpecSchema } from "@/shared/lib/schemas";
import type { BuildSpec } from "@/shared/lib/types";

const UPLOAD_ID = `upl_${"0".repeat(32)}`;

/** The issue's reproduction, extended to every source kind and to `schema`/unknown keys. */
const YAML = `dataset_id: air-quality
title: Air quality
description: Station measurements
sources:
  - provider: datago
    dataset: air_quality
    params:
      numOfRows: 100
    param_grid:
      year: [2024, 2025]
      sido: [서울, 부산]
    gold:
      select: [owner_name, pm10]
      filters:
        - column: pm10
          op: ge
          value: 0
        - column: owner_name
          op: not_null
      pii_columns: [owner_name]
      publish_unmasked: []
    schema:
      required: [pm10]
      dtypes: {}
      casts: {}
      rename: {pm10Value: pm10}
      null_tokens: ["-"]
    future_source_field: kept
  - kind: file
    upload_id: ${UPLOAD_ID}
    format: csv
    encoding: cp949
    alias: owners
    gold:
      pii_columns: [phone]
      publish_unmasked: [phone]
  - kind: url
    endpoint: https://example.org/data.json
    method: GET
    format: json
    alias: remote
    gold:
      select: [id]
exports:
  - kind: jsonl
    output_path: out/data.jsonl
metadata:
  outputPath: out
pii:
  mode: block
`;

function wireSources(spec: BuildSpec) {
  return toBuilderSpec(spec).sources;
}

/** The raw YAML sources: what a faithful round trip must send back to Builder. */
const ORIGINAL_SOURCES = (parseYaml(YAML) as { sources: unknown[] }).sources;

function expectPreserved(spec: BuildSpec) {
  expect(wireSources(spec)).toEqual(ORIGINAL_SOURCES);
}

beforeEach(() => localStorage.clear());
afterEach(() => localStorage.clear());

describe("YAML ↔ BuildSpec keeps source contract fields (#601)", () => {
  it("toYamlText(fromYamlText(yaml)) keeps param_grid and gold on every source", () => {
    const restored = fromYamlText(toYamlText(fromYamlText(YAML)));
    const [api, file, url] = toBuilderSpec(restored).sources as Array<Record<string, unknown>>;

    expect(api.param_grid).toEqual({ year: [2024, 2025], sido: ["서울", "부산"] });
    expect(api.gold).toEqual({
      select: ["owner_name", "pm10"],
      filters: [
        { column: "pm10", op: "ge", value: 0 },
        { column: "owner_name", op: "not_null" },
      ],
      pii_columns: ["owner_name"],
      publish_unmasked: [],
    });
    expect(api.schema).toMatchObject({ rename: { pm10Value: "pm10" }, null_tokens: ["-"] });
    expect(api.future_source_field).toBe("kept");
    expect(file).toMatchObject({ kind: "file", encoding: "cp949", gold: { pii_columns: ["phone"], publish_unmasked: ["phone"] } });
    expect(url).toMatchObject({ kind: "url", gold: { select: ["id"] } });
    expect(toBuilderSpec(restored)).toMatchObject({ pii: { mode: "block" } });
  });

  it("maps gold PII keys to camelCase in Studio and never invents keys", () => {
    const [api, , url] = fromYamlText(YAML).sources;
    expect(api.paramGrid).toEqual({ year: [2024, 2025], sido: ["서울", "부산"] });
    expect(api.gold?.piiColumns).toEqual(["owner_name"]);
    expect(api.gold?.publishUnmasked).toEqual([]);
    expect(api.extra).toEqual({ future_source_field: "kept" });
    // A declared-only key set comes back as exactly that set: no default unmasking.
    expect(url.gold).toEqual({ select: ["id"] });
    expect(toBuilderSpec(fromYamlText(YAML)).sources[2]).not.toHaveProperty("gold.publish_unmasked");
    // A source that declared neither gains neither.
    const plain: BuilderSpec = {
      dataset_id: "d",
      title: "t",
      description: "x",
      sources: [{ provider: "datago", dataset: "air_quality", params: {} }],
      exports: [{ kind: "jsonl", output_path: "out/data.jsonl" }],
      metadata: {},
    };
    expect(toBuilderSpec(fromBuilderSpec(plain)).sources[0]).toEqual({
      provider: "datago",
      dataset: "air_quality",
      params: {},
    });
  });

  it("modeled fields win over a same-named key in source extra", () => {
    const spec = fromYamlText(YAML);
    spec.sources[0] = { ...spec.sources[0], extra: { params: { stale: true }, gold: null } };
    const wire = toBuilderSpec(spec).sources[0] as Record<string, unknown>;
    expect(wire.params).toEqual({ numOfRows: 100 });
    expect(wire.gold).toMatchObject({ pii_columns: ["owner_name"] });
  });
});

describe("Zod parsing and persistence keep source contract fields (#601)", () => {
  it("buildSpecSchema.parse keeps paramGrid, gold, loose schema and source extra", () => {
    const parsed = buildSpecSchema.parse(fromYamlText(YAML)) as BuildSpec;
    expectPreserved(parsed);
  });

  it("spec store save → load keeps them", () => {
    saveBuildSpec("run-601", fromYamlText(YAML));
    const loaded = loadBuildSpec("run-601");
    expect(loaded).not.toBeNull();
    expectPreserved(loaded as BuildSpec);
  });

  it("spec store redacts credentials inside source extra like params", () => {
    const secret = "super-secret-value-601";
    const spec = fromYamlText(YAML);
    spec.sources[0] = { ...spec.sources[0], extra: { auth: { serviceKey: secret } } };
    saveBuildSpec("run-601-secret", spec);
    expect(JSON.stringify(localStorage)).not.toContain(secret);
    expect(loadBuildSpec("run-601-secret")?.sources[0].extra).toEqual({ auth: { serviceKey: "[REDACTED]" } });
  });
});

describe("Add Data: YAML apply → form edit → submitted payload (#601)", () => {
  const applied = () => applyBuildSpecToDraft(INITIAL_DRAFT, fromYamlText(YAML));

  it("an untouched draft submits every source field unchanged", () => {
    const result = buildSpecFromDraft(applied());
    expect(result.error).toBeUndefined();
    expectPreserved(result.spec as BuildSpec);
  });

  it("form edits win while param_grid and gold are kept in the submitted payload", () => {
    const draft = applied();
    const edited = {
      ...draft,
      title: "Edited title",
      publicApi: { ...draft.publicApi, sourceParams: '{"numOfRows": 500}' },
    };
    const result = buildSpecFromDraft(edited);
    expect(result.error).toBeUndefined();
    const payload = JSON.parse(serializeSpec(result.spec as BuildSpec)) as {
      title: string;
      sources: Array<Record<string, unknown>>;
    };

    expect(payload.title).toBe("Edited title");
    expect(payload.sources[0].params).toEqual({ numOfRows: 500 });
    expect(payload.sources[0].param_grid).toEqual({ year: [2024, 2025], sido: ["서울", "부산"] });
    expect(payload.sources[0].gold).toMatchObject({ pii_columns: ["owner_name"], publish_unmasked: [] });
    expect(payload.sources.slice(1)).toEqual(ORIGINAL_SOURCES.slice(1));
  });

  it("draft save → restore keeps them", () => {
    saveAddDataDraft(applied());
    const restored = loadAddDataDraft();
    expect(restored).not.toBeNull();
    const result = buildSpecFromDraft(restored!);
    expect(result.error).toBeUndefined();
    expectPreserved(result.spec as BuildSpec);
  });
});

describe("New Build form round trip keeps source contract fields (#601)", () => {
  it("toBuildSpec(toFormValues(spec), spec) keeps them and applies form edits", () => {
    const base = fromYamlText(YAML);
    const values = { ...toFormValues(base), sourceParams: '{"numOfRows": 10}' };
    const result = toBuildSpec(values, base);
    expect(result.error).toBeUndefined();
    const [api, ...rest] = wireSources(result.spec as BuildSpec) as Array<Record<string, unknown>>;
    expect(api).toEqual({ ...(ORIGINAL_SOURCES[0] as object), params: { numOfRows: 10 } });
    expect(rest).toEqual(ORIGINAL_SOURCES.slice(1));
  });
});
