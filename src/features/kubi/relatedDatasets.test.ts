import { describe, expect, it } from "vitest";
import { relatedCatalogDatasets } from "./relatedDatasets";
import type { KubiEvidence } from "./types";

function makeEvidence(overrides: Partial<KubiEvidence> = {}): KubiEvidence {
  return {
    fetchedAt: "2026-08-14T00:00:00.000Z",
    context: { page: "dataset-detail", datasetId: "air-quality" },
    deepLinks: {},
    partial: false,
    unavailable: [],
    ...overrides,
  };
}

describe("relatedCatalogDatasets (#256 이슈 — 관련 데이터셋 후보는 실제 catalog evidence와 대조)", () => {
  it("returns nothing when catalog evidence failed to load", () => {
    const evidence = makeEvidence({
      dataset: {
        datasetId: "air-quality",
        title: "대기질",
        providers: ["datago"],
        sources: [{ provider: "datago", dataset: "air" }],
        latestRunId: "run-1",
        status: "ok",
        updatedAt: null,
        totalRowCount: 100,
      },
    });
    expect(relatedCatalogDatasets(evidence)).toEqual([]);
  });

  it("returns nothing when no dataset is in context (nothing to relate to)", () => {
    const evidence = makeEvidence({
      catalog: { providers: ["datago"], datasetsByProvider: { datago: ["air_quality", "traffic"] } },
    });
    expect(relatedCatalogDatasets(evidence)).toEqual([]);
  });

  it("lists sibling catalog datasets from the same provider, excluding the dataset itself", () => {
    const evidence = makeEvidence({
      dataset: {
        datasetId: "air-quality",
        title: "대기질",
        providers: ["datago"],
        sources: [{ provider: "datago", dataset: "air_quality" }],
        latestRunId: "run-1",
        status: "ok",
        updatedAt: null,
        totalRowCount: 100,
      },
      catalog: {
        providers: ["datago"],
        datasetsByProvider: { datago: ["air_quality", "traffic", "population"] },
      },
    });
    expect(relatedCatalogDatasets(evidence)).toEqual([
      { provider: "datago", dataset: "traffic" },
      { provider: "datago", dataset: "population" },
    ]);
  });

  it("never suggests a provider the dataset itself has no source from (no guessing across unrelated providers)", () => {
    const evidence = makeEvidence({
      dataset: {
        datasetId: "air-quality",
        title: "대기질",
        providers: ["datago"],
        sources: [{ provider: "datago", dataset: "air_quality" }],
        latestRunId: "run-1",
        status: "ok",
        updatedAt: null,
        totalRowCount: 100,
      },
      catalog: {
        providers: ["datago", "kosis"],
        datasetsByProvider: { datago: ["air_quality"], kosis: ["population"] },
      },
    });
    expect(relatedCatalogDatasets(evidence)).toEqual([]);
  });

  it("caps candidates at the requested limit", () => {
    const evidence = makeEvidence({
      dataset: {
        datasetId: "air-quality",
        title: "대기질",
        providers: ["datago"],
        sources: [{ provider: "datago", dataset: "air_quality" }],
        latestRunId: "run-1",
        status: "ok",
        updatedAt: null,
        totalRowCount: 100,
      },
      catalog: {
        providers: ["datago"],
        datasetsByProvider: { datago: ["air_quality", "a", "b", "c", "d", "e"] },
      },
    });
    expect(relatedCatalogDatasets(evidence, 2)).toEqual([
      { provider: "datago", dataset: "a" },
      { provider: "datago", dataset: "b" },
    ]);
  });

  it("does not fabricate a candidate for a catalog dataset name that never actually appeared", () => {
    // catalog에 없는 provider를 dataset.providers가 우연히 들고 있어도(예: 조회 실패 후 잔여값)
    // datasetsByProvider에 없는 provider는 빈 배열로 취급해 아무것도 만들어내지 않는다.
    const evidence = makeEvidence({
      dataset: {
        datasetId: "air-quality",
        title: "대기질",
        providers: ["unknown-provider"],
        sources: [],
        latestRunId: "run-1",
        status: "ok",
        updatedAt: null,
        totalRowCount: 100,
      },
      catalog: { providers: ["datago"], datasetsByProvider: { datago: ["air_quality"] } },
    });
    expect(relatedCatalogDatasets(evidence)).toEqual([]);
  });
});
