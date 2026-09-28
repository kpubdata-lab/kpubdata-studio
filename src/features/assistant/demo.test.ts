/**
 * Unit tests for Ask KPubData mock/dev demo (#256 review — Ask KPubData demo in mock mode).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildAssistantDemoResponse, isAssistantDemoAvailable, runAssistantDemoQuery } from "./demo";
import type { AssistantEvidence } from "./types";

function baseEvidence(overrides: Partial<AssistantEvidence> = {}): AssistantEvidence {
  return {
    fetchedAt: "2026-08-14T00:00:00Z",
    context: { page: "dataset-detail", datasetId: "air-quality" },
    deepLinks: {},
    partial: false,
    unavailable: [],
    ...overrides,
  };
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("isAssistantDemoAvailable (#256 데모)", () => {
  it("is available when VITE_USE_REAL_BUILDER is unset (mock mode)", () => {
    expect(isAssistantDemoAvailable()).toBe(true);
  });

  it("is unavailable in real mode — real mode always requires BYOK", () => {
    vi.stubEnv("VITE_USE_REAL_BUILDER", "true");
    expect(isAssistantDemoAvailable()).toBe(false);
  });
});

describe("buildAssistantDemoResponse (#256 데모)", () => {
  it("never fabricates a dataset — with no dataset evidence it says so plainly and adds no dataset ref/actions", () => {
    const response = buildAssistantDemoResponse(baseEvidence({ context: { page: "home" } }));
    expect(response.answer).toContain("[DEMO]");
    expect(response.answer).toContain("선택된 Dataset이 없어");
    expect(response.evidenceRefs).toHaveLength(0);
    expect(response.suggestedActions).toHaveLength(0);
    expect(response.generatedSql).toBeNull();
  });

  it("only cites the dataset/quality ids that are actually present in evidence", () => {
    const evidence = baseEvidence({
      dataset: {
        datasetId: "air-quality",
        title: "대기질 통합 데이터",
        providers: ["data.go.kr"],
        sources: [{ provider: "data.go.kr", dataset: "air" }],
        latestRunId: "air-2026-08-14",
        status: "failed",
        updatedAt: null,
        totalRowCount: 1200,
      },
      quality: {
        availability: "partial",
        evaluatedChecks: 2,
        results: [
          {
            id: "datago__air::missing::max_null_ratio::pm10",
            source: "datago__air",
            category: "missing",
            rule: "max_null_ratio",
            column: "pm10",
            status: "pass",
            actual: 0.01,
            threshold: 0.05,
            detail: null,
          },
        ],
        schemaDrift: [],
      },
    });

    const response = buildAssistantDemoResponse(evidence);

    expect(response.evidenceRefs).toContainEqual({ kind: "dataset", id: "air-quality", label: "대기질 통합 데이터" });
    expect(response.evidenceRefs).toContainEqual({
      kind: "quality",
      id: "datago__air::missing::max_null_ratio::pm10",
      label: "missing/max_null_ratio",
    });
    // Only OPEN_QUALITY and ADD_REPORT_BLOCK are rendered — Build/execute/Publish etc. are never shown.
    expect(response.suggestedActions.map((a) => a.type).sort()).toEqual(["ADD_REPORT_BLOCK", "OPEN_QUALITY"]);
  });

  it("only proposes Generated SQL when the current context stage is silver/gold, matching the real LLM contract", () => {
    const datasetOnly = baseEvidence({
      dataset: {
        datasetId: "air-quality",
        title: "대기질 통합 데이터",
        providers: [],
        sources: [],
        latestRunId: "air-2026-08-14",
        status: "ok",
        updatedAt: null,
        totalRowCount: 100,
      },
    });
    expect(buildAssistantDemoResponse(datasetOnly).generatedSql).toBeNull();

    const withStage = baseEvidence({
      ...datasetOnly,
      context: { page: "dataset-detail", datasetId: "air-quality", stage: "silver" },
      stage: { refId: "run-1::datago__air::silver", stage: "silver", source: "datago__air", status: "completed", available: true, rowCount: 1000 },
    });
    const response = buildAssistantDemoResponse(withStage);
    expect(response.generatedSql).toEqual({
      sql: "SELECT region, COUNT(*) AS count FROM dataset GROUP BY region",
      stage: "silver",
      source: "datago__air",
    });
    expect(response.evidenceRefs).toContainEqual({ kind: "stage", id: "run-1::datago__air::silver", label: "datago__air · silver" });
  });

  it("demo SQL never uses the source_key as a FROM table name — only the logical relation \"dataset\"", () => {
    const evidence = baseEvidence({
      context: { page: "dataset-detail", datasetId: "air-quality", stage: "gold" },
      stage: { refId: "run-1::datago__air::gold", stage: "gold", source: "datago__air", status: "completed", available: true, rowCount: 1000 },
    });
    const response = buildAssistantDemoResponse(evidence);
    expect(response.generatedSql?.sql).toMatch(/FROM dataset\b/);
    expect(response.generatedSql?.sql).not.toContain(evidence.stage!.source);
    expect(response.generatedSql?.source).toBe("datago__air");
  });
});

describe("runAssistantDemoQuery (#256 데모)", () => {
  it("never calls fetch and returns a fixed mock result", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const result = await runAssistantDemoQuery();
    expect(result.status).toBe("success");
    if (result.status === "success") {
      expect(result.result.columns).toEqual(["region", "count"]);
      expect(result.result.rows.length).toBeGreaterThan(0);
    }
    expect(fetchMock).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});
