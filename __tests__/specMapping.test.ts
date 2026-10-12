import { describe, expect, it } from "vitest";
import { serializeSpec, toBuilderSpec } from "@/features/build-spec/specMapping";
import type { BuildSpec } from "@/shared/lib/types";

const spec: BuildSpec = {
  datasetId: "apt-trade",
  title: "대기오염",
  description: "설명",
  sources: [{ provider: "datago", dataset: "air", params: { sidoName: "서울" }, alias: "aq" }],
  exports: [{ format: "jsonl" }, { format: "huggingface", options: { outputPath: "hf/aq" } }],
  metadata: { outputPath: "artifacts/builds/aq" },
};

describe("toBuilderSpec (#37)", () => {
  it("maps camelCase Studio fields to snake_case Builder fields", () => {
    const result = toBuilderSpec(spec);
    expect(result.dataset_id).toBe("apt-trade");
    expect(result.sources[0]).toEqual({
      provider: "datago",
      dataset: "air",
      params: { sidoName: "서울" },
      alias: "aq",
    });
  });

  it("preserves JSON-valued source params and schema contracts (#234)", () => {
    const result = toBuilderSpec({
      ...spec,
      sources: [
        {
          provider: "datago",
          dataset: "air_quality",
          params: {
            sidoName: "서울",
            page: 1,
            includeMeta: true,
            filters: { grade: ["good", "normal"] },
          },
          schema: {
            required: ["station"],
            dtypes: { value: "Float64" },
            casts: { value: "float" },
          },
        },
      ],
    });

    expect(result.sources[0]?.params).toEqual({
      sidoName: "서울",
      page: 1,
      includeMeta: true,
      filters: { grade: ["good", "normal"] },
    });
    expect(result.sources[0]?.schema).toEqual({
      required: ["station"],
      dtypes: { value: "Float64" },
      casts: { value: "float" },
    });
  });

  it("maps export format → kind and derives output_path", () => {
    const result = toBuilderSpec(spec);
    expect(result.exports[0]).toEqual({
      kind: "jsonl",
      output_path: "artifacts/builds/aq/data.jsonl",
    });
    // huggingface는 디렉터리 경로(옵션 우선).
    expect(result.exports[1].kind).toBe("huggingface");
    expect(result.exports[1].output_path).toBe("hf/aq");
  });

  it("preserves open export kinds and explicit output paths (#234)", () => {
    const result = toBuilderSpec({
      ...spec,
      exports: [
        { format: "csv", options: { outputPath: "exports/data.csv", delimiter: "," } },
      ],
    });

    expect(result.exports[0]).toEqual({
      kind: "csv",
      output_path: "exports/data.csv",
      options: { outputPath: "exports/data.csv", delimiter: "," },
    });
  });

  it("derives distinct output paths for repeated export kinds (#234)", () => {
    const result = toBuilderSpec({
      ...spec,
      exports: [{ format: "jsonl" }, { format: "jsonl" }],
    });

    expect(result.exports.map((target) => target.output_path)).toEqual([
      "artifacts/builds/aq/data.jsonl",
      "artifacts/builds/aq/data-2.jsonl",
    ]);
  });

  it("omits alias when absent", () => {
    const noAlias = toBuilderSpec({
      ...spec,
      sources: [{ provider: "datago", dataset: "air", params: {} }],
    });
    expect(noAlias.sources[0]).not.toHaveProperty("alias");
  });

  it("serializeSpec returns parseable JSON (a YAML subset)", () => {
    const parsed = JSON.parse(serializeSpec(spec));
    expect(parsed.dataset_id).toBe("apt-trade");
  });
});
