import { describe, expect, it } from "vitest";
import { highestCompletedStage, summarizeDatasetStages } from "@/features/datasets/model";
import { summarizeQuality } from "@/features/quality/model";
import type { BuildQualityResponse, RunStageEntry } from "@/shared/lib/builderApi";

function quality(statuses: Array<"pass" | "warn" | "fail">): BuildQualityResponse {
  return {
    run_id: "run-1",
    availability: "available",
    evaluated_checks: statuses.length,
    quality_results: {
      source: statuses.map((status, index) => ({
        source_key: "source",
        category: "test",
        rule: `rule-${index}`,
        column: null,
        status,
        actual: 1,
        threshold: 1,
        affected_rows: null,
        evaluated_rows: null,
        detail: null,
      })),
    },
    schema_drift: {},
  };
}

describe("Dataset stage/validation policy (#253)", () => {
  it("uses FAIL > WARN > PASS and keeps no evaluated result as N/A", () => {
    expect(summarizeQuality(quality([]))).toBe("N/A");
    expect(summarizeQuality(quality(["pass"]))).toBe("PASS");
    expect(summarizeQuality(quality(["pass", "warn"]))).toBe("WARN");
    expect(summarizeQuality(quality(["pass", "warn", "fail"]))).toBe("FAIL");
  });

  it("never defaults to Gold when no stage completed", () => {
    const source: RunStageEntry = {
      source_key: "source",
      bronze: { status: "failed", available: false },
      silver: { status: "not_run", available: false },
      gold: { status: "unavailable", available: false },
    };
    expect(highestCompletedStage(source)).toBe("bronze");
  });

  it("keeps mixed and failed catalog states visible in one compact summary", () => {
    expect(summarizeDatasetStages({
      first: { bronze: "completed", silver: "completed", gold: "completed" },
      second: { bronze: "completed", silver: "failed", gold: "not_run" },
    }).label).toBe("혼합 / 실패");
    expect(summarizeDatasetStages({
      first: { bronze: "completed", silver: "completed", gold: "unavailable" },
    }).label).toBe("Silver");
  });
});
