/**
 * Every combination of export formats Studio offers must produce export paths Builder
 * accepts (kpubdata-builder#1320).
 *
 * Builder refuses a BuildSpec when one export's `output_path` equals or contains another's,
 * names a Gold artifact (`table.parquet`, `package.json`, `splits`, `README.md`,
 * `card.json`), or leaves the Gold directory. Both flows that write a spec are walked over
 * every ordered choice of formats, with the default path and with a typed one, and the
 * resulting wire paths are checked with an oracle written here from Builder's
 * `export_path_parts` / `export_layout_conflicts`, independent of Studio's own checker.
 */
import { describe, expect, it } from "vitest";
import { INITIAL_DRAFT, buildSpecFromDraft, type AddDataDraft } from "@/features/add-data/model";
import { toBuildSpec, type BuildFormValues } from "@/features/build-spec/newBuildModel";
import { toBuilderSpec } from "@/features/build-spec/specMapping";
import { exportFormatSchema } from "@/shared/lib/schemas";

const FORMATS = exportFormatSchema.options;
const RESERVED = ["table.parquet", "package.json", "splits", "README.md", "card.json"];

function fold(segment: string): string {
  return segment.normalize("NFC").toUpperCase().toLowerCase().replace(/[. ]+$/, "");
}

/** Builder's rules, restated: why `paths` would be refused, or an empty list. */
function builderRefusals(paths: string[]): string[] {
  const refusals: string[] = [];
  const keys: string[][] = [];
  for (const path of paths) {
    const parts = path.split(/[\\/]/).filter((part) => part !== "" && part !== ".");
    if (/^([\\/]|[A-Za-z]:)/.test(path) || parts.length === 0 || parts.some((p) => p === ".." || fold(p) === "")) {
      refusals.push(`unsafe ${path}`);
    }
    keys.push(parts.map(fold));
  }
  const reserved = new Set(RESERVED.map(fold));
  keys.forEach((key, i) => {
    if (reserved.has(key[0] ?? "")) refusals.push(`reserved ${paths[i]}`);
    keys.slice(0, i).forEach((other, j) => {
      const n = Math.min(key.length, other.length);
      if (key.slice(0, n).join("/") === other.slice(0, n).join("/")) {
        refusals.push(`${paths[i]} overlaps ${paths[j]}`);
      }
    });
  });
  return refusals;
}

/** Every ordered selection of one or more formats — the order the user ticks them in. */
function orderedSelections(items: readonly string[]): string[][] {
  const out: string[][] = [];
  const walk = (picked: string[]) => {
    if (picked.length > 0) out.push(picked);
    for (const item of items) if (!picked.includes(item)) walk([...picked, item]);
  };
  walk([]);
  return out;
}

const SELECTIONS = orderedSelections(FORMATS);

function formValues(exportFormats: string[], outputPath: string): BuildFormValues {
  return {
    datasetId: "air",
    title: "Air",
    description: "Air quality",
    provider: "datago",
    sourceDataset: "air_quality",
    sourceParams: "{}",
    outputPath,
    exportFormats,
  };
}

function draft(exportFormats: string[], outputPath: string): AddDataDraft {
  return {
    ...INITIAL_DRAFT,
    sourceKind: "public_api",
    publicApi: { provider: "datago", dataset: "air_quality", sourceParams: "{}" },
    datasetId: "air",
    title: "Air",
    description: "Air quality",
    exportFormats,
    outputPath,
  };
}

describe("export paths for every format combination (kpubdata-builder#1320)", () => {
  it("walks all ordered selections of the offered formats", () => {
    expect(SELECTIONS).toHaveLength(64);
  });

  for (const outputPath of ["artifacts/builds/air", "out/air"]) {
    it(`new-build form never produces paths Builder refuses (path ${outputPath})`, () => {
      for (const formats of SELECTIONS) {
        const { spec, error } = toBuildSpec(formValues(formats, outputPath));
        expect(error, formats.join(",")).toBeUndefined();
        const paths = toBuilderSpec(spec!).exports.map((target) => target.output_path);
        expect(builderRefusals(paths), formats.join(",")).toEqual([]);
      }
    });
  }

  for (const outputPath of ["", "out/air"]) {
    it(`add-data never produces paths Builder refuses (typed path "${outputPath}")`, () => {
      for (const formats of SELECTIONS) {
        const { spec, error } = buildSpecFromDraft(draft(formats, outputPath));
        expect(error, formats.join(",")).toBeUndefined();
        const paths = toBuilderSpec(spec!).exports.map((target) => target.output_path);
        expect(builderRefusals(paths), formats.join(",")).toEqual([]);
      }
    });
  }

  it("keeps the single-format default layout artifacts/builds/<id>/data.<ext>", () => {
    const extension: Record<string, string> = { markdown: "md", jsonl: "jsonl", parquet: "parquet" };
    for (const format of ["markdown", "jsonl", "parquet"]) {
      const { spec } = buildSpecFromDraft(draft([format], ""));
      expect(toBuilderSpec(spec!).exports.map((target) => target.output_path)).toEqual([
        `artifacts/builds/air/data.${extension[format]}`,
      ]);
    }
    const { spec } = buildSpecFromDraft(draft(["huggingface"], ""));
    expect(toBuilderSpec(spec!).exports[0]?.output_path).toBe("artifacts/builds/air");
  });

  it("keeps a typed path as-is when only one format is chosen", () => {
    const { spec } = buildSpecFromDraft(draft(["jsonl"], "out/air.jsonl"));
    expect(toBuilderSpec(spec!).exports[0]?.output_path).toBe("out/air.jsonl");
  });

  it("puts the Hugging Face folder beside the other exports, not around them", () => {
    const { spec } = toBuildSpec(formValues(["huggingface", "jsonl"], "artifacts/builds/air"));
    expect(toBuilderSpec(spec!).exports.map((target) => target.output_path)).toEqual([
      "artifacts/builds/air-1",
      "artifacts/builds/air/data-2.jsonl",
    ]);
  });
});
