import { describe, expect, it } from "vitest";
import { contextsMatch, resolveKubiContext } from "@/features/kubi/context";

describe("resolveKubiContext (#247, #256)", () => {
  it("labels the home route", () => {
    expect(resolveKubiContext("/").pageLabel).toBe("Home");
    expect(resolveKubiContext("/").context.page).toBe("home");
  });

  it("labels each top-level IA route", () => {
    expect(resolveKubiContext("/discover").pageLabel).toBe("Discover");
    expect(resolveKubiContext("/workspace").pageLabel).toBe("Workspace");
    expect(resolveKubiContext("/add").pageLabel).toBe("Add Data");
    expect(resolveKubiContext("/quality").pageLabel).toBe("Quality");
    expect(resolveKubiContext("/kubi").pageLabel).toBe("Ask KPubData");
    expect(resolveKubiContext("/reports").pageLabel).toBe("Reports");
    expect(resolveKubiContext("/provider").pageLabel).toBe("Provider");
    expect(resolveKubiContext("/monitoring").pageLabel).toBe("Monitoring");
  });

  it("extracts datasetId from a dataset detail route", () => {
    const { context, pageLabel } = resolveKubiContext("/datasets/air-quality");
    expect(pageLabel).toBe("Dataset 상세");
    expect(context.page).toBe("dataset-detail");
    expect(context.datasetId).toBe("air-quality");
  });

  it("does not treat the dataset catalog itself as a dataset id", () => {
    const { context, pageLabel } = resolveKubiContext("/datasets");
    expect(pageLabel).toBe("Dataset Catalog");
    expect(context.datasetId).toBeUndefined();
  });

  it("extracts runId from build-scoped routes but not from /builds/new", () => {
    expect(resolveKubiContext("/builds/run-1").context.runId).toBe("run-1");
    expect(resolveKubiContext("/builds/run-1/run").context.runId).toBe("run-1");
    expect(resolveKubiContext("/builds/new").context.runId).toBeUndefined();
    expect(resolveKubiContext("/builds").context.runId).toBeUndefined();
  });

  it("reads dataset/run/stage from Dataset Detail's ?run=&stage= query convention (#253)", () => {
    const { context } = resolveKubiContext("/datasets/air-quality", "?run=run-9&stage=silver");
    expect(context.datasetId).toBe("air-quality");
    expect(context.runId).toBe("run-9");
    expect(context.stage).toBe("silver");
  });

  it("reads dataset/run/stage from Quality's ?dataset=&run=&stage= query convention (#254)", () => {
    const { context } = resolveKubiContext("/quality", "?dataset=air-quality&run=run-9&stage=gold");
    expect(context.page).toBe("quality");
    expect(context.datasetId).toBe("air-quality");
    expect(context.runId).toBe("run-9");
    expect(context.stage).toBe("gold");
  });

  it("ignores an invalid stage query value instead of guessing", () => {
    const { context } = resolveKubiContext("/quality", "?stage=platinum");
    expect(context.stage).toBeUndefined();
  });

  it("does not populate qualityResultIds/provider from route alone (only evidence can)", () => {
    const { context } = resolveKubiContext("/quality", "?dataset=air-quality");
    expect(context.qualityResultIds).toBeUndefined();
    expect(context.provider).toBeUndefined();
  });
});

describe("contextsMatch (stale guard, #256)", () => {
  it("matches identical page/dataset/run/stage", () => {
    const a = { page: "quality", datasetId: "d1", runId: "r1", stage: "silver" as const };
    const b = { page: "quality", datasetId: "d1", runId: "r1", stage: "silver" as const };
    expect(contextsMatch(a, b)).toBe(true);
  });

  it("treats a changed datasetId as stale", () => {
    const a = { page: "dataset-detail", datasetId: "d1" };
    const b = { page: "dataset-detail", datasetId: "d2" };
    expect(contextsMatch(a, b)).toBe(false);
  });

  it("treats a changed stage as stale", () => {
    const a = { page: "quality", datasetId: "d1", stage: "silver" as const };
    const b = { page: "quality", datasetId: "d1", stage: "gold" as const };
    expect(contextsMatch(a, b)).toBe(false);
  });

  it("treats undefined and missing the same way on both sides", () => {
    const a = { page: "home" };
    const b = { page: "home", datasetId: undefined };
    expect(contextsMatch(a, b)).toBe(true);
  });
});
