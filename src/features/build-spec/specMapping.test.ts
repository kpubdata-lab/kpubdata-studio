import { describe, expect, it } from "vitest";

import type { BuilderSpec } from "./specMapping";
import { fromBuilderSpec, serializeSpec, toBuilderSpec } from "./specMapping";
import type { BuildSpec } from "@/shared/lib/types";

const baseBuilderSpec: BuilderSpec = {
  dataset_id: "sample",
  title: "샘플",
  description: "설명",
  sources: [{ provider: "github", dataset: "repos", params: {} }],
  exports: [
    { kind: "jsonl", output_path: "artifacts/builds/sample/data.jsonl" },
  ],
  metadata: {},
};

describe("fromBuilderSpec", () => {
  it("Builder export의 output_path를 options.outputPath로 보존한다", () => {
    const result = fromBuilderSpec(baseBuilderSpec);
    expect(result.exports[0]?.options?.["outputPath"]).toBe(
      "artifacts/builds/sample/data.jsonl",
    );
  });

  it("기존 options를 유지하면서 output_path를 병합한다", () => {
    const spec: BuilderSpec = {
      ...baseBuilderSpec,
      exports: [
        {
          kind: "huggingface",
          output_path: "datasets/sample",
          options: { repoId: "org/sample" },
        },
      ],
    };
    const result = fromBuilderSpec(spec);
    expect(result.exports[0]?.options).toMatchObject({
      repoId: "org/sample",
      outputPath: "datasets/sample",
    });
  });

  it("알 수 없는 Builder export kind도 round-trip 보존한다 (#234)", () => {
    const spec: BuilderSpec = {
      ...baseBuilderSpec,
      exports: [{ kind: "csv", output_path: "exports/data.csv" }],
    };
    const result = fromBuilderSpec(spec);

    expect(result.exports[0]).toMatchObject({
      format: "csv",
      options: { outputPath: "exports/data.csv" },
    });
  });

  it("JSON params와 source schema를 Studio spec으로 보존한다 (#234)", () => {
    const spec: BuilderSpec = {
      ...baseBuilderSpec,
      sources: [
        {
          provider: "datago",
          dataset: "air_quality",
          params: { page: 1, includeMeta: true, filters: { grade: ["good"] } },
          schema: {
            required: ["station"],
            dtypes: { value: "Float64" },
            casts: { value: "float" },
          },
        },
      ],
    };
    const result = fromBuilderSpec(spec);

    expect(result.sources[0]?.params).toEqual({
      page: 1,
      includeMeta: true,
      filters: { grade: ["good"] },
    });
    expect(result.sources[0]?.schema).toEqual({
      required: ["station"],
      dtypes: { value: "Float64" },
      casts: { value: "float" },
    });
  });

  it("kind='file' source의 upload_id/format/encoding을 보존한다 (#250, #498)", () => {
    const spec: BuilderSpec = {
      ...baseBuilderSpec,
      sources: [
        {
          kind: "file",
          upload_id: "upl_0123456789abcdef0123456789abcdef",
          format: "csv",
          encoding: "utf-8",
        },
      ],
    };
    const result = fromBuilderSpec(spec);

    expect(result.sources[0]).toMatchObject({
      kind: "file",
      uploadId: "upl_0123456789abcdef0123456789abcdef",
      format: "csv",
      encoding: "utf-8",
    });
    expect(result.sources[0]?.provider).toBeUndefined();
  });

  it("kind='url' source의 endpoint/method를 보존한다 (#250, #498)", () => {
    const spec: BuilderSpec = {
      ...baseBuilderSpec,
      sources: [
        { kind: "url", endpoint: "https://api.example.org/data", method: "GET", format: "json" },
      ],
    };
    const result = fromBuilderSpec(spec);

    expect(result.sources[0]).toMatchObject({
      kind: "url",
      endpoint: "https://api.example.org/data",
      method: "GET",
      format: "json",
    });
  });

  it("kind가 없는(public_api) source는 kind 필드 없이 round-trip한다(하위 호환)", () => {
    const result = fromBuilderSpec(baseBuilderSpec);
    expect(result.sources[0]?.kind).toBeUndefined();

    const back = toBuilderSpec(result);
    expect(back.sources[0]).not.toHaveProperty("kind");
  });
});

describe("toBuilderSpec/fromBuilderSpec — extra 최상위 필드 round-trip (#250 amendment 2)", () => {
  it("Studio가 모델링하지 않는 최상위 canonical 필드(extra)를 fromBuilderSpec → toBuilderSpec 왕복에서 잃지 않는다", () => {
    const wireSpec = {
      ...baseBuilderSpec,
      license: "CC-BY-4.0",
      publish: true,
      splits: { train: 0.8, test: 0.2 },
      pii: { columns: ["email"], strategy: "redact" },
      quality: { min_rows: 100 },
      composition: { join: [{ left: "a", right: "b", on: "id" }] },
    } as unknown as BuilderSpec;

    const studioSpec = fromBuilderSpec(wireSpec);
    expect(studioSpec.extra).toEqual({
      license: "CC-BY-4.0",
      publish: true,
      splits: { train: 0.8, test: 0.2 },
      pii: { columns: ["email"], strategy: "redact" },
      quality: { min_rows: 100 },
      composition: { join: [{ left: "a", right: "b", on: "id" }] },
    });

    const roundTripped = toBuilderSpec(studioSpec) as unknown as Record<string, unknown>;
    expect(roundTripped.license).toBe("CC-BY-4.0");
    expect(roundTripped.publish).toBe(true);
    expect(roundTripped.splits).toEqual({ train: 0.8, test: 0.2 });
    expect(roundTripped.pii).toEqual({ columns: ["email"], strategy: "redact" });
    expect(roundTripped.quality).toEqual({ min_rows: 100 });
    expect(roundTripped.composition).toEqual({ join: [{ left: "a", right: "b", on: "id" }] });
  });

  it("알려진 필드가 항상 extra의 동일 키보다 우선한다", () => {
    const spec: BuildSpec = {
      datasetId: "known-wins",
      title: "실제 제목",
      description: "설명",
      sources: [{ provider: "datago", dataset: "air_quality", params: {} }],
      exports: [{ format: "jsonl" }],
      metadata: {},
       // Never happens via GUI (would require hand-editing YAML), but assume extra key conflicts
       // with known field — known field should win.
      extra: { title: "extra에만 있던 제목", datasetId: "should-not-win" } as never,
    };

    const wire = toBuilderSpec(spec);
    expect(wire.title).toBe("실제 제목");
    expect(wire.dataset_id).toBe("known-wins");
  });

  it("known/unknown 최상위 필드 모두 spec/preview/build 제출에 쓰는 serializeSpec 문자열에 그대로 남는다", () => {
    const wireSpec = { ...baseBuilderSpec, quality: { min_rows: 1 } } as unknown as BuilderSpec;
    const studioSpec = fromBuilderSpec(wireSpec);

    const wireText = serializeSpec(studioSpec);
    const reparsed = JSON.parse(wireText) as Record<string, unknown>;
    expect(reparsed.quality).toEqual({ min_rows: 1 });
    expect(reparsed.dataset_id).toBe("sample");
  });
});

describe("toBuilderSpec — kind별 params 계약 (#283 후속 리뷰 §1, Builder OpenAPI SourceRef)", () => {
  it("public_api source는 params key를 포함한다", () => {
    const spec: BuildSpec = {
      datasetId: "d",
      title: "t",
      description: "desc",
      sources: [{ provider: "datago", dataset: "air_quality", params: { page: 1 } }],
      exports: [{ format: "jsonl" }],
      metadata: {},
    };
    const wire = toBuilderSpec(spec);
    expect(wire.sources[0]).toHaveProperty("params", { page: 1 });
  });

  it("file source wire에는 params/provider/dataset/endpoint/method가 없다", () => {
    const spec: BuildSpec = {
      datasetId: "d",
      title: "t",
      description: "desc",
      sources: [{
        kind: "file",
        uploadId: "upl_0123456789abcdef0123456789abcdef",
        format: "csv",
        encoding: "utf-8",
        params: {},
      }],
      exports: [{ format: "jsonl" }],
      metadata: {},
    };
    const wire = toBuilderSpec(spec);
    const source = wire.sources[0] as Record<string, unknown>;
    expect(source).not.toHaveProperty("params");
    expect(source).not.toHaveProperty("provider");
    expect(source).not.toHaveProperty("dataset");
    expect(source).not.toHaveProperty("endpoint");
    expect(source).not.toHaveProperty("method");
    expect(source).toMatchObject({
      kind: "file",
      upload_id: "upl_0123456789abcdef0123456789abcdef",
      format: "csv",
      encoding: "utf-8",
    });
  });

  it("url source wire에는 params/provider/dataset/upload_id/encoding이 없다", () => {
    const spec: BuildSpec = {
      datasetId: "d",
      title: "t",
      description: "desc",
      sources: [{
        kind: "url",
        endpoint: "https://api.example.org/data",
        method: "GET",
        format: "json",
        params: {},
      }],
      exports: [{ format: "jsonl" }],
      metadata: {},
    };
    const wire = toBuilderSpec(spec);
    const source = wire.sources[0] as Record<string, unknown>;
    expect(source).not.toHaveProperty("params");
    expect(source).not.toHaveProperty("provider");
    expect(source).not.toHaveProperty("dataset");
    expect(source).not.toHaveProperty("upload_id");
    expect(source).not.toHaveProperty("encoding");
    expect(source).toMatchObject({
      kind: "url",
      endpoint: "https://api.example.org/data",
      method: "GET",
      format: "json",
    });
  });

  it("file/url → fromBuilderSpec 왕복 시 Studio 내부 params는 다시 {}로 채워진다", () => {
    const fileSpec: BuildSpec = {
      datasetId: "d",
      title: "t",
      description: "desc",
      sources: [{
        kind: "file",
        uploadId: "upl_0123456789abcdef0123456789abcdef",
        format: "csv",
        encoding: "utf-8",
        params: {},
      }],
      exports: [{ format: "jsonl" }],
      metadata: {},
    };
    const roundTripped = fromBuilderSpec(toBuilderSpec(fileSpec));
    expect(roundTripped.sources[0]?.params).toEqual({});
  });
});
