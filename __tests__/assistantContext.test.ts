import { describe, expect, it } from "vitest";
import { contextsMatch, resolveAssistantContext } from "@/features/assistant/context";

describe("resolveAssistantContext (#247, #256)", () => {
  it("labels the home route", () => {
    expect(resolveAssistantContext("/").pageLabel).toBe("Home");
    expect(resolveAssistantContext("/").context.page).toBe("home");
  });

  it("labels each top-level IA route", () => {
    expect(resolveAssistantContext("/discover").pageLabel).toBe("Discover");
    expect(resolveAssistantContext("/workspace").pageLabel).toBe("Workspace");
    expect(resolveAssistantContext("/add").pageLabel).toBe("Add Data");
    expect(resolveAssistantContext("/quality").pageLabel).toBe("Quality");
    expect(resolveAssistantContext("/assistant").pageLabel).toBe("Ask KPubData");
    expect(resolveAssistantContext("/reports").pageLabel).toBe("Reports");
    expect(resolveAssistantContext("/provider").pageLabel).toBe("Provider");
    expect(resolveAssistantContext("/monitoring").pageLabel).toBe("Monitoring");
  });

  it("extracts datasetId from a dataset detail route", () => {
    const { context, pageLabel } = resolveAssistantContext("/datasets/air-quality");
    expect(pageLabel).toBe("Dataset 상세");
    expect(context.page).toBe("dataset-detail");
    expect(context.datasetId).toBe("air-quality");
  });

  it("does not treat the dataset catalog itself as a dataset id", () => {
    const { context, pageLabel } = resolveAssistantContext("/datasets");
    expect(pageLabel).toBe("Dataset Catalog");
    expect(context.datasetId).toBeUndefined();
  });

  it("extracts runId from build-scoped routes but not from /builds/new", () => {
    expect(resolveAssistantContext("/builds/run-1").context.runId).toBe("run-1");
    expect(resolveAssistantContext("/builds/run-1/run").context.runId).toBe("run-1");
    expect(resolveAssistantContext("/builds/new").context.runId).toBeUndefined();
    expect(resolveAssistantContext("/builds").context.runId).toBeUndefined();
  });

  it("reads dataset/run/stage from Dataset Detail's ?run=&stage= query convention (#253)", () => {
    const { context } = resolveAssistantContext("/datasets/air-quality", "?run=run-9&stage=silver");
    expect(context.datasetId).toBe("air-quality");
    expect(context.runId).toBe("run-9");
    expect(context.stage).toBe("silver");
  });

  it("reads dataset/run/stage from Quality's ?dataset=&run=&stage= query convention (#254)", () => {
    const { context } = resolveAssistantContext("/quality", "?dataset=air-quality&run=run-9&stage=gold");
    expect(context.page).toBe("quality");
    expect(context.datasetId).toBe("air-quality");
    expect(context.runId).toBe("run-9");
    expect(context.stage).toBe("gold");
  });

  it("ignores an invalid stage query value instead of guessing", () => {
    const { context } = resolveAssistantContext("/quality", "?stage=platinum");
    expect(context.stage).toBeUndefined();
  });

  it("does not populate qualityResultIds/provider from route alone (only evidence can)", () => {
    const { context } = resolveAssistantContext("/quality", "?dataset=air-quality");
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
