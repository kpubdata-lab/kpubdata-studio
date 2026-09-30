import { describe, expect, it } from "vitest";
import { contextsMatch, resolveAssistantContext } from "@/features/assistant/context";

describe("resolveAssistantContext (#247, #256)", () => {
  it("labels the home route", () => {
    expect(resolveAssistantContext("/").pageLabel).toBe("홈");
    expect(resolveAssistantContext("/").context.page).toBe("home");
  });

  it("labels each top-level IA route", () => {
    expect(resolveAssistantContext("/discover").pageLabel).toBe("카탈로그");
    expect(resolveAssistantContext("/workspace").pageLabel).toBe("작업대");
    expect(resolveAssistantContext("/add").pageLabel).toBe("테이블 만들기");
    expect(resolveAssistantContext("/quality").pageLabel).toBe("품질");
    expect(resolveAssistantContext("/assistant").pageLabel).toBe("Ask KPubData");
    expect(resolveAssistantContext("/reports").pageLabel).toBe("리포트");
    expect(resolveAssistantContext("/connections").pageLabel).toBe("연결");
    expect(resolveAssistantContext("/monitoring").pageLabel).toBe("모니터링");
  });

  it("extracts datasetId from a dataset detail route", () => {
    const { context, pageLabel } = resolveAssistantContext("/tables/air-quality");
    expect(pageLabel).toBe("테이블 상세");
    expect(context.page).toBe("dataset-detail");
    expect(context.datasetId).toBe("air-quality");
  });

  it("does not treat the dataset catalog itself as a dataset id", () => {
    const { context, pageLabel } = resolveAssistantContext("/tables");
    expect(pageLabel).toBe("테이블 카탈로그");
    expect(context.datasetId).toBeUndefined();
  });

  it("extracts runId from build-scoped routes but not from /builds/new", () => {
    expect(resolveAssistantContext("/refresh-jobs/run-1").context.runId).toBe("run-1");
    expect(resolveAssistantContext("/refresh-jobs/run-1/run").context.runId).toBe("run-1");
    expect(resolveAssistantContext("/refresh-jobs/new").context.runId).toBeUndefined();
    expect(resolveAssistantContext("/refresh-jobs").context.runId).toBeUndefined();
  });

  it("reads dataset/run/stage from Dataset Detail's ?run=&stage= query convention (#253)", () => {
    const { context } = resolveAssistantContext("/tables/air-quality", "?run=run-9&stage=silver");
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
