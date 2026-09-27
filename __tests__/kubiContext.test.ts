import { describe, expect, it } from "vitest";
import { contextsMatch, resolveAsk KPubDataContext } from "@/features/kubi/context";

describe("resolveAsk KPubDataContext (#247, #256)", () => {
  it("labels the home route", () => {
    expect(resolveAsk KPubDataContext("/").pageLabel).toBe("Home");
    expect(resolveAsk KPubDataContext("/").context.page).toBe("home");
  });

  it("labels each top-level IA route", () => {
    expect(resolveAsk KPubDataContext("/discover").pageLabel).toBe("Discover");
    expect(resolveAsk KPubDataContext("/workspace").pageLabel).toBe("Workspace");
    expect(resolveAsk KPubDataContext("/add").pageLabel).toBe("Add Data");
    expect(resolveAsk KPubDataContext("/quality").pageLabel).toBe("Quality");
    expect(resolveAsk KPubDataContext("/kubi").pageLabel).toBe("Ask KPubData");
    expect(resolveAsk KPubDataContext("/reports").pageLabel).toBe("Reports");
    expect(resolveAsk KPubDataContext("/provider").pageLabel).toBe("Provider");
    expect(resolveAsk KPubDataContext("/monitoring").pageLabel).toBe("Monitoring");
  });

  it("extracts datasetId from a dataset detail route", () => {
    const { context, pageLabel } = resolveAsk KPubDataContext("/datasets/air-quality");
    expect(pageLabel).toBe("Dataset 상세");
    expect(context.page).toBe("dataset-detail");
    expect(context.datasetId).toBe("air-quality");
  });

  it("does not treat the dataset catalog itself as a dataset id", () => {
    const { context, pageLabel } = resolveAsk KPubDataContext("/datasets");
    expect(pageLabel).toBe("Dataset Catalog");
    expect(context.datasetId).toBeUndefined();
  });

  it("extracts runId from build-scoped routes but not from /builds/new", () => {
    expect(resolveAsk KPubDataContext("/builds/run-1").context.runId).toBe("run-1");
    expect(resolveAsk KPubDataContext("/builds/run-1/run").context.runId).toBe("run-1");
    expect(resolveAsk KPubDataContext("/builds/new").context.runId).toBeUndefined();
    expect(resolveAsk KPubDataContext("/builds").context.runId).toBeUndefined();
  });

  it("reads dataset/run/stage from Dataset Detail's ?run=&stage= query convention (#253)", () => {
    const { context } = resolveAsk KPubDataContext("/datasets/air-quality", "?run=run-9&stage=silver");
    expect(context.datasetId).toBe("air-quality");
    expect(context.runId).toBe("run-9");
    expect(context.stage).toBe("silver");
  });

  it("reads dataset/run/stage from Quality's ?dataset=&run=&stage= query convention (#254)", () => {
    const { context } = resolveAsk KPubDataContext("/quality", "?dataset=air-quality&run=run-9&stage=gold");
    expect(context.page).toBe("quality");
    expect(context.datasetId).toBe("air-quality");
    expect(context.runId).toBe("run-9");
    expect(context.stage).toBe("gold");
  });

  it("ignores an invalid stage query value instead of guessing", () => {
    const { context } = resolveAsk KPubDataContext("/quality", "?stage=platinum");
    expect(context.stage).toBeUndefined();
  });

  it("does not populate qualityResultIds/provider from route alone (only evidence can)", () => {
    const { context } = resolveAsk KPubDataContext("/quality", "?dataset=air-quality");
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
