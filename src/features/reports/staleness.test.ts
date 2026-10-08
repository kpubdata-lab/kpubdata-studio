// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { checkReportEvidenceStatus } from "./staleness";

afterEach(() => {
  localStorage.clear();
});

describe("checkReportEvidenceStatus (#258 §8)", () => {
  it("기준 run이 dataset의 최신 run이면 CURRENT", async () => {
    const result = await checkReportEvidenceStatus("air-quality", "air-2026-08-14");
    expect(result.status).toBe("current");
  });

  it("기준 run은 유효하지만 더 최신 run이 있으면 STALE(자동 교체하지 않고 알리기만)", async () => {
    const result = await checkReportEvidenceStatus("air-quality", "air-2026-08-13");
    expect(result.status).toBe("stale");
    expect(result.latestRunId).toBe("air-2026-08-14");
  });

  it("기준 run이 run 목록에서 사라졌으면 ORPHAN", async () => {
    const result = await checkReportEvidenceStatus("air-quality", "air-run-that-was-deleted");
    expect(result.status).toBe("orphan");
  });

  it("run 목록 자체를 조회하지 못하면 UNAVAILABLE(CURRENT/STALE/ORPHAN 중 무엇인지 단정하지 않음)", async () => {
    const result = await checkReportEvidenceStatus("does-not-exist-dataset", "some-run");
    expect(result.status).toBe("unavailable");
  });
});
