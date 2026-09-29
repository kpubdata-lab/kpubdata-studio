import { describe, expect, it } from "vitest";
import { buildSpecSchema } from "@/shared/lib/schemas";

describe("buildSpecSchema", () => {
  it("accepts a valid build spec", () => {
    const result = buildSpecSchema.safeParse({
      datasetId: "air-quality-seoul",
      title: "Seoul Air Quality",
      description: "Collects city air quality observations.",
      sources: [
        {
          provider: "datago",
          dataset: "air-quality",
          params: { city: "seoul" },
        },
      ],
      exports: [{ format: "jsonl" }, { format: "markdown" }],
      metadata: { outputPath: "artifacts/seoul-air" },
    });

    expect(result.success).toBe(true);
  });

  it("accepts Builder-compatible JSON params and open export kinds (#234)", () => {
    const result = buildSpecSchema.safeParse({
      datasetId: "air-quality-seoul",
      title: "Seoul Air Quality",
      description: "Collects city air quality observations.",
      sources: [
        {
          provider: "datago",
          dataset: "air_quality",
          params: { page: 1, includeMeta: true, filters: { grade: ["good"] } },
        },
      ],
      exports: [{ format: "csv", options: { outputPath: "exports/data.csv" } }],
      metadata: { outputPath: "artifacts/seoul-air" },
    });

    expect(result.success).toBe(true);
  });

  it("rejects an invalid build spec", () => {
    const result = buildSpecSchema.safeParse({
      datasetId: "",
      title: "",
      description: "",
      sources: [],
      exports: [],
      metadata: {},
    });

    expect(result.success).toBe(false);

    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe("Table ID (dataset_id) is required.");
    }
  });
});
