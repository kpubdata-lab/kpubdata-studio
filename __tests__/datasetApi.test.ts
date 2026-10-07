import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, builderApi } from "@/shared/lib/builderApi";

function mockResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
  } as Response;
}

const summary = {
  dataset_id: "air-quality",
  title: "대기질",
  sources: [{ provider: "data.go.kr", dataset: "air", alias: "air" }],
  latest_run_id: "run-1",
  status: "ok",
  updated_at: "2026-08-14T00:00:00Z",
  row_counts: { air: 10 },
  total_row_count: 10,
  stages: { air: { bronze: "completed", silver: "completed", gold: "not_run" } },
  quality: null,
} as const;

afterEach(() => vi.unstubAllGlobals());

describe("Builder 1.6.0 dataset/stage/quality client (#253)", () => {
  it("validates datasets list, detail, and runs responses", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(mockResponse(200, { datasets: [summary] }))
      .mockResolvedValueOnce(mockResponse(200, { ...summary, run_count: 1 }))
      .mockResolvedValueOnce(mockResponse(200, { dataset_id: "air-quality", runs: [{ run_id: "run-1", status: "ok", started_at: null, finished_at: null, spec_digest: null, created_by: null }] }));
    vi.stubGlobal("fetch", fetchMock);

    expect((await builderApi.listDatasets()).datasets[0].quality).toBeNull();
    expect((await builderApi.getDataset("air/quality")).run_count).toBe(1);
    expect((await builderApi.listDatasetRuns("air/quality")).runs[0].run_id).toBe("run-1");
    expect(String(fetchMock.mock.calls[1][0])).toContain("air%2Fquality");
  });

  it("validates the bronze/silver/gold discriminated stage responses", async () => {
    const bronze = { run_id: "run-1", stage: "bronze", source_key: "air", status: "completed", available: true, provider: "data.go.kr", dataset: "air", fetched_at: null, record_count: 10 };
    const silver = { run_id: "run-1", stage: "silver", source_key: "air", status: "completed", available: true, row_count: 10, schema: [], statistics: null, validation: null, sample: [] };
    const gold = { run_id: "run-1", stage: "gold", source_key: "air", status: "not_run", available: false, row_count: null, columns: [], splits: null, exports: [], sample: null, sample_available: false };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(mockResponse(200, bronze)).mockResolvedValueOnce(mockResponse(200, silver)).mockResolvedValueOnce(mockResponse(200, gold)));

    expect((await builderApi.getBuildStageDetail("run-1", "bronze", "air")).stage).toBe("bronze");
    expect((await builderApi.getBuildStageDetail("run-1", "silver", "air")).stage).toBe("silver");
    expect((await builderApi.getBuildStageDetail("run-1", "gold", "air")).stage).toBe("gold");
  });

  it("validates run stages and quality responses", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(mockResponse(200, { run_id: "run-1", sources: [{ source_key: "air", bronze: { status: "completed", available: true }, silver: { status: "failed", available: false }, gold: { status: "not_run", available: false } }] }))
      .mockResolvedValueOnce(mockResponse(200, { run_id: "run-1", availability: "partial", evaluated_checks: 1, quality_results: { air: [{ source_key: "air", category: "missing", rule: "max_null_ratio", column: "value", status: "warn", actual: 0.2, threshold: 0.1, affected_rows: 2, evaluated_rows: 10, detail: null }] }, schema_drift: { air: [] } }))
      .mockResolvedValueOnce(mockResponse(200, { dataset_id: "air-quality", runs: [{ run_id: "run-1", timestamp: null, status: "ok", pass_count: 0, warn_count: 1, fail_count: 0, evaluated_checks: 1, rule_pass_rate: 0, validated_rows: 10 }] })));

    expect((await builderApi.listBuildStages("run-1")).sources[0].silver.status).toBe("failed");
    const quality = await builderApi.getBuildQuality("run-1");
    expect(quality.quality_results.air[0].status).toBe("warn");
    expect(quality.availability).toBe("partial");
    expect(quality.evaluated_checks).toBe(1);
    expect((await builderApi.getDatasetQualityHistory("air-quality")).runs[0].evaluated_checks).toBe(1);
  });

  it("rejects malformed dataset and stage responses", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(mockResponse(200, { datasets: [{ dataset_id: "broken" }] })).mockResolvedValueOnce(mockResponse(200, { run_id: "run-1", stage: "silver", source_key: "air", status: "completed", available: true })));
    // A 200 Studio cannot read keeps its real status and says so (#791); it used to read as a 500.
    await expect(builderApi.listDatasets()).rejects.toMatchObject({ name: "ContractMismatchError", status: 200, code: "schema_mismatch" });
    await expect(builderApi.getBuildStageDetail("run-1", "silver", "air")).rejects.toMatchObject({ name: "ContractMismatchError", status: 200, code: "schema_mismatch" });
  });

  it.each([403, 404])("preserves HTTP %s for access and missing-resource errors", async (status) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockResponse(status, { error: status === 403 ? "forbidden" : "not found" })));
    const error = await builderApi.getDataset("air-quality").catch((cause) => cause);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(status);
  });
});
