import { describe, expect, it } from "vitest";
import { contextsMatch, resolveKubiContext } from "./context";

/**
 * KubiContext SSOT resolver (#256 + #319 follow-up).
 *
 * Ask KPubData reads route (`?dataset=&run=&source=&stage=`) as context alone. QualityPage/Dataset Detail
 * sends selected source via `?source=`, resolver must pass as `source` so multi-source run queries
 * stage evidence from correct source, and stale-marks prior turn when source changes.
 */
describe("resolveKubiContext — source_key", () => {
  it("carries ?source= into context.source on the quality route", () => {
    const { context } = resolveKubiContext(
      "/quality",
      "?dataset=air-quality&run=air-2026-08-14&source=datago__air&stage=silver",
    );
    expect(context).toMatchObject({
      page: "quality",
      datasetId: "air-quality",
      runId: "air-2026-08-14",
      source: "datago__air",
      stage: "silver",
    });
  });

  it("treats an empty ?source= ('전체 소스') as no source_key — not guessed", () => {
    const { context } = resolveKubiContext("/quality", "?dataset=air-quality&run=r1&source=");
    expect(context.source).toBeUndefined();
  });

  it("resolves ?source= on the dataset-detail route too", () => {
    const { context } = resolveKubiContext("/datasets/air-quality", "?run=r1&source=kma__weather&stage=gold");
    expect(context.source).toBe("kma__weather");
  });
});

describe("contextsMatch — source_key participates in the stale guard", () => {
  const base = { page: "quality", datasetId: "d", runId: "r", stage: "silver" as const };

  it("same source_key → match", () => {
    expect(contextsMatch({ ...base, source: "datago__air" }, { ...base, source: "datago__air" })).toBe(true);
  });

  it("different source_key → no match (turn goes stale)", () => {
    expect(contextsMatch({ ...base, source: "datago__air" }, { ...base, source: "kma__weather" })).toBe(false);
  });

  it("source_key present vs absent → no match", () => {
    expect(contextsMatch({ ...base, source: "datago__air" }, base)).toBe(false);
  });
});
