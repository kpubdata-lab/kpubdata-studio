/**
 * Studio's restatement of Builder's export-path rules, and how Builder's own refusals are
 * shown (kpubdata-builder#1320).
 */
import { describe, expect, it } from "vitest";
import { INITIAL_DRAFT, buildSpecFromDraft } from "@/features/add-data/model";
import { toBuildSpec } from "@/features/build-spec/newBuildModel";
import { asInvalidDetails } from "@/features/validation/api";
import { i18n } from "@/shared/i18n";
import en from "@/shared/i18n/locales/en.json";
import ko from "@/shared/i18n/locales/ko.json";
import { formatApiErrorMessage } from "@/shared/lib/builderApi";
import { EXPORT_PATH_CODES, exportPathProblems } from "@/shared/lib/exportPaths";

const codes = (exports: Array<[string, string]>) =>
  exportPathProblems(exports.map(([kind, output_path]) => ({ kind, output_path }))).map(
    (problem) => `${problem.index}:${problem.code}`,
  );

describe("exportPathProblems", () => {
  it("accepts distinct paths, sibling folders and ./ prefixes", () => {
    expect(codes([["jsonl", "out/data.jsonl"], ["parquet", "./out/data-2.parquet"], ["huggingface", "out-3"]])).toEqual([]);
  });

  it("refuses absolute paths, drive letters, '..' and paths naming nothing", () => {
    expect(codes([["jsonl", "/abs/data.jsonl"]])).toEqual(["0:unsafe_export_path"]);
    expect(codes([["jsonl", "\\share\\data.jsonl"]])).toEqual(["0:unsafe_export_path"]);
    expect(codes([["jsonl", "C:data.jsonl"]])).toEqual(["0:unsafe_export_path"]);
    expect(codes([["jsonl", "out/../../data.jsonl"]])).toEqual(["0:unsafe_export_path"]);
    expect(codes([["jsonl", "./."]])).toEqual(["0:unsafe_export_path"]);
    expect(codes([["jsonl", "out/.../x"]])).toEqual(["0:unsafe_export_path"]);
  });

  it("refuses the Gold artifacts, whatever their case", () => {
    for (const name of ["table.parquet", "package.json", "splits/train.jsonl", "README.md", "Card.JSON"]) {
      expect(codes([["jsonl", name]]), name).toEqual(["0:reserved_export_path"]);
    }
    expect(codes([["jsonl", "out/README.md"]])).toEqual([]);
  });

  it("refuses an export equal to, or inside, another, as filesystems compare names", () => {
    expect(codes([["jsonl", "out"], ["parquet", "out"]])).toEqual(["1:export_path_collision"]);
    expect(codes([["huggingface", "out"], ["jsonl", "out/data.jsonl"]])).toEqual(["1:export_path_collision"]);
    expect(codes([["jsonl", "out/data.jsonl"], ["huggingface", "out"]])).toEqual(["1:export_path_collision"]);
    expect(codes([["jsonl", "Out/Data.jsonl"], ["markdown", "out/data.jsonl."]])).toEqual(["1:export_path_collision"]);
  });

  it("keeps other exports off a Kaggle export's metadata and card files", () => {
    expect(codes([["kaggle", "k/data.csv"], ["jsonl", "k/dataset-metadata.json"]])).toEqual(["1:export_path_collision"]);
    expect(codes([["kaggle", "k/data.csv"], ["jsonl", "k/README.md"]])).toEqual(["1:export_path_collision"]);
    expect(codes([["kaggle", "dataset-metadata.json"]])).toEqual(["0:export_path_collision"]);
    expect(codes([["kaggle", "data.csv"], ["jsonl", "README.md"]])).toEqual(["1:reserved_export_path"]);
  });
});

describe("export-path messages", () => {
  it("has every code in Korean and English", () => {
    for (const code of EXPORT_PATH_CODES) {
      expect(ko.exportPaths[code]).toContain("{{n}}");
      expect(en.exportPaths[code]).toContain("{{n}}");
    }
  });

  it("stops the new-build form before submitting a path Builder refuses", () => {
    const { error } = toBuildSpec({
      datasetId: "air",
      title: "Air",
      description: "Air quality",
      provider: "datago",
      sourceDataset: "air_quality",
      sourceParams: "{}",
      outputPath: "../outside",
      exportFormats: ["jsonl"],
    });
    expect(error).toBe(i18n.t("exportPaths.unsafe_export_path", { n: 1 }));
  });

  it("stops add-data when a pasted spec makes two exports share a path", () => {
    const { error } = buildSpecFromDraft({
      ...INITIAL_DRAFT,
      sourceKind: "public_api",
      publicApi: { provider: "datago", dataset: "air_quality", sourceParams: "{}" },
      datasetId: "air",
      title: "Air",
      description: "Air quality",
      exportFormats: ["jsonl", "parquet"],
      canonicalBase: {
        datasetId: "air",
        title: "Air",
        description: "Air quality",
        sources: [{ provider: "datago", dataset: "air_quality", params: {} }],
        exports: [
          { format: "jsonl", options: { outputPath: "out/data" } },
          { format: "parquet", options: { outputPath: "out/data" } },
        ],
        metadata: {},
      },
    });
    expect(error).toBe(i18n.t("exportPaths.export_path_collision", { n: 2 }));
  });

  const refused = {
    status: "invalid",
    problems: ["exports[1].output_path 'out/data.jsonl' overlaps exports[0].output_path 'out'", "sources must not be empty"],
    structured_problems: [
      {
        code: "export_path_collision",
        path: "exports[1].output_path",
        message: "exports[1].output_path 'out/data.jsonl' overlaps exports[0].output_path 'out'",
        hint: null,
      },
      { code: "empty_field", path: "sources", message: "sources must not be empty", hint: null },
    ],
  };

  it("says Builder's export-path refusals in the user's language on validation", () => {
    expect(asInvalidDetails(refused)?.problems).toEqual([
      i18n.t("exportPaths.export_path_collision", { n: 2 }),
      "sources must not be empty",
    ]);
  });

  it("says them in the user's language when a build or preview is refused", () => {
    expect(formatApiErrorMessage(400, refused)).toBe(i18n.t("exportPaths.export_path_collision", { n: 2 }));
    const reserved = {
      status: "invalid",
      problems: ["x"],
      structured_problems: [{ code: "reserved_export_path", path: "exports[0].output_path", message: "x", hint: null }],
    };
    expect(formatApiErrorMessage(400, reserved)).toBe(i18n.t("exportPaths.reserved_export_path", { n: 1 }));
  });
});
