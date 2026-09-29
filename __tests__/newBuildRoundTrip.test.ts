/**
 * Editing an existing BuildSpec through the New Build wizard must not drop fields the
 * form does not edit (#496).
 *
 * `toBuildSpec(toFormValues(spec), spec)` is exactly what the wizard does when a spec is
 * opened for editing and saved without touching anything. It has to give back the same
 * spec — same keys, same order, same values — so the comparison is on the serialized JSON,
 * not on `toEqual`, which would forgive a key that silently turned into `undefined`.
 */
import { describe, expect, it } from "vitest";
import {
  editBlockReason,
  toBuildSpec,
  toFormValues,
} from "@/features/build-spec/newBuildModel";
import type { BuildSpec } from "@/shared/lib/types";

const RICH_SPEC: BuildSpec = {
  datasetId: "air-quality",
  title: "대기오염",
  description: "설명",
  sources: [
    {
      kind: "public_api",
      provider: "datago",
      dataset: "air",
      params: { sidoName: "서울", page: 1 },
      alias: "aq",
      schema: {
        required: ["station", "pm10"],
        dtypes: { pm10: "float64" },
        casts: { pm10: "float64" },
      },
    },
    {
      kind: "url",
      params: {},
      alias: "stations",
      format: "csv",
      endpoint: "https://example.com/stations.csv",
      method: "GET",
    },
    {
      kind: "file",
      params: {},
      alias: "codes",
      uploadId: "upl_0123456789abcdef0123456789abcdef",
      format: "csv",
      encoding: "cp949",
    },
  ],
  exports: [
    { format: "jsonl" },
    { format: "parquet", options: { compression: "zstd" } },
    {
      format: "huggingface",
      options: { outputPath: "hf/aq", repoId: "org/air-quality", private: true },
    },
  ],
  metadata: { outputPath: "artifacts/builds/aq", owner: "team-a" },
  extra: {
    license: "KOGL-1",
    splits: { train: 0.8, test: 0.2 },
    publish: { target: "huggingface" },
  },
};

describe("toBuildSpec round-trip on edit (#496)", () => {
  it("keeps schema, alias, kind, export options, extra and extra sources byte-for-byte", () => {
    const result = toBuildSpec(toFormValues(RICH_SPEC), RICH_SPEC);
    expect(result.error).toBeUndefined();
    expect(JSON.stringify(result.spec)).toBe(JSON.stringify(RICH_SPEC));
  });

  it("overwrites only the fields the form edits", () => {
    const values = {
      ...toFormValues(RICH_SPEC),
      title: "새 제목",
      sourceDataset: "air2",
      sourceParams: '{"sidoName":"부산"}',
      outputPath: "artifacts/builds/aq2",
    };
    const { spec, error } = toBuildSpec(values, RICH_SPEC);
    expect(error).toBeUndefined();
    expect(spec?.title).toBe("새 제목");
    expect(spec?.sources[0]).toEqual({
      ...RICH_SPEC.sources[0],
      dataset: "air2",
      params: { sidoName: "부산" },
    });
    expect(spec?.sources.slice(1)).toEqual(RICH_SPEC.sources.slice(1));
    // huggingface keeps its other options; only outputPath follows the form.
    expect(spec?.exports[2]).toEqual({
      format: "huggingface",
      options: { outputPath: "artifacts/builds/aq2", repoId: "org/air-quality", private: true },
    });
    expect(spec?.exports[1]).toEqual({ format: "parquet", options: { compression: "zstd" } });
    expect(spec?.metadata).toEqual({ outputPath: "artifacts/builds/aq2", owner: "team-a" });
    expect(spec?.extra).toEqual(RICH_SPEC.extra);
  });

  it("does not carry a removed export's options onto nothing, and a new export starts bare", () => {
    const values = { ...toFormValues(RICH_SPEC), exportFormats: ["jsonl", "csv"] };
    const { spec } = toBuildSpec(values, RICH_SPEC);
    expect(spec?.exports).toEqual([{ format: "jsonl" }, { format: "csv" }]);
  });

  it("fills huggingface outputPath from the form when the export had none", () => {
    const base: BuildSpec = {
      ...RICH_SPEC,
      exports: [{ format: "huggingface", options: { repoId: "org/air-quality" } }],
    };
    const { spec } = toBuildSpec(toFormValues(base), base);
    expect(spec?.exports).toEqual([
      { format: "huggingface", options: { repoId: "org/air-quality", outputPath: "artifacts/builds/aq" } },
    ]);
  });

  it("does not invent metadata.outputPath for a spec that never had one", () => {
    const base: BuildSpec = { ...RICH_SPEC, metadata: { owner: "team-a" } };
    const { spec } = toBuildSpec(toFormValues(base), base);
    expect(spec?.metadata).toEqual({ owner: "team-a" });
  });

  it("builds a new spec without base the same way as before", () => {
    const { spec } = toBuildSpec({
      datasetId: "d",
      title: "t",
      description: "desc",
      provider: "datago",
      sourceDataset: "air",
      sourceParams: "{}",
      outputPath: "out",
      exportFormats: ["jsonl", "huggingface"],
    });
    expect(spec).toEqual({
      datasetId: "d",
      title: "t",
      description: "desc",
      sources: [{ provider: "datago", dataset: "air", params: {} }],
      exports: [{ format: "jsonl" }, { format: "huggingface", options: { outputPath: "out" } }],
      metadata: { outputPath: "out" },
    });
  });
});

describe("editBlockReason (#496)", () => {
  it("allows a spec whose first source is a public API (explicit or implicit kind)", () => {
    expect(editBlockReason(RICH_SPEC)).toBeNull();
    const implicit: BuildSpec = {
      ...RICH_SPEC,
      sources: [{ provider: "datago", dataset: "air", params: {} }],
    };
    expect(editBlockReason(implicit)).toBeNull();
  });

  it.each(["file", "url"] as const)("blocks a spec whose first source is kind=%s", (kind) => {
    const blocked: BuildSpec = { ...RICH_SPEC, sources: [RICH_SPEC.sources[kind === "url" ? 1 : 2]] };
    expect(editBlockReason(blocked)).toMatch(kind);
  });

  it("refuses to assemble a spec over a base the form cannot express", () => {
    const blocked: BuildSpec = { ...RICH_SPEC, sources: [RICH_SPEC.sources[1]] };
    const { spec, error } = toBuildSpec(toFormValues(blocked), blocked);
    expect(spec).toBeUndefined();
    expect(error).toBeTruthy();
  });
});
