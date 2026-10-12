/**
 * preview API 진입점 테스트 (#93).
 *
 * 실연동 모드에서 Builder `/preview`의 실제 와이어 형태({dataset_id, previews})를 UI가 쓰는
 * {rows, schema}로 변환하는지, mock 모드에서는 네트워크 없이 결정적 mock 데이터를 반환하는지 검증한다.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { PreviewSourceFailureError, previewBuild } from "@/features/preview/api";
import type { BuildSpec } from "@/shared/lib/types";

function mockResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

/** #497로 SourcePreview에 추가된 필수 필드의 최소 기본값(테스트 fixture 축약용). */
function requiredPreviewFields(sample: Record<string, unknown>[] = []) {
  return {
    statistics: { row_count: sample.length, null_counts: {}, duplicate_rate: 0 },
    quality_results: [],
    source_sample: sample,
    sample_mode: "first" as const,
    diff_available: false,
    diffs: [],
    transform_summary: null,
    diff_truncated: false,
  };
}

const SPEC: BuildSpec = {
  datasetId: "apt-trade",
  title: "대기오염 정보",
  description: "테스트",
  sources: [{ provider: "datago", dataset: "apt-trade", params: {} }],
  exports: [{ format: "jsonl" }],
  metadata: {},
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("previewBuild (#93)", () => {
  it("calls Builder /preview and maps the {dataset_id, previews} shape to {rows, schema} in real mode", async () => {
    vi.stubEnv("VITE_USE_REAL_BUILDER", "true");
    const fetchMock = vi.fn().mockResolvedValue(
      mockResponse(200, {
        dataset_id: "apt-trade",
        previews: [
          {
            source_key: "datago.apt-trade",
            status: "ok",
            error: null,
            schema: [
              { name: "region", dtype: "string", nullable: false, unique_count: 3 },
              { name: "value", dtype: "int64", nullable: true, unique_count: 3 },
            ],
            sample: [
              { region: "서울", value: 42 },
              { region: "부산", value: 37 },
            ],
            total_rows: 2,
            statistics: { row_count: 2, null_counts: { region: 0, value: 0 }, duplicate_rate: 0 },
            quality_results: [],
            source_sample: [
              { region: "서울", value: 42 },
              { region: "부산", value: 37 },
            ],
            sample_mode: "first",
            diff_available: false,
            diffs: [],
            transform_summary: null,
            diff_truncated: false,
          },
        ],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await previewBuild(SPEC);

    expect(String(fetchMock.mock.calls[0][0])).toContain("/preview");
    expect(fetchMock.mock.calls[0][1].method).toBe("POST");
    expect(result.schema).toEqual({ region: "string", value: "int64" });
    expect(result.rows).toEqual([
      { region: "서울", value: 42 },
      { region: "부산", value: 37 },
    ]);
  });

  it("prefers the first ok source when multiple previews are returned", async () => {
    vi.stubEnv("VITE_USE_REAL_BUILDER", "true");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        mockResponse(200, {
          dataset_id: "multi",
          previews: [
            {
              source_key: "a",
              status: "failed",
              error: "boom",
              schema: [],
              sample: [],
              total_rows: 0,
              ...requiredPreviewFields(),
            },
            {
              source_key: "b",
              status: "ok",
              error: null,
              schema: [{ name: "id", dtype: "string", nullable: false, unique_count: 1 }],
              sample: [{ id: "x" }],
              total_rows: 1,
              ...requiredPreviewFields([{ id: "x" }]),
            },
          ],
        }),
      ),
    );

    const result = await previewBuild(SPEC);

    expect(result.schema).toEqual({ id: "string" });
    expect(result.rows).toEqual([{ id: "x" }]);
  });

  it("throws source-keyed errors when every Builder preview source failed (#235)", async () => {
    vi.stubEnv("VITE_USE_REAL_BUILDER", "true");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        mockResponse(200, {
          dataset_id: "multi",
          previews: [
            {
              source_key: "datago.air",
              status: "failed",
              error: "인증 실패",
              schema: [],
              sample: [],
              total_rows: 0,
              ...requiredPreviewFields(),
            },
            {
              source_key: "kosis.pop",
              status: "failed",
              error: "조회 실패",
              schema: [],
              sample: [],
              total_rows: 0,
              ...requiredPreviewFields(),
            },
          ],
        }),
      ),
    );

    const error = await previewBuild(SPEC).catch((cause) => cause);

    expect(error).toBeInstanceOf(PreviewSourceFailureError);
    expect((error as PreviewSourceFailureError).message).toBe(
      "모든 미리보기 소스가 실패했습니다: datago.air: 인증 실패; kosis.pop: 조회 실패",
    );
    expect((error as PreviewSourceFailureError).failures).toEqual([
      { sourceKey: "datago.air", error: "인증 실패" },
      { sourceKey: "kosis.pop", error: "조회 실패" },
    ]);
  });

  it("preserves failed source warnings beside the first successful preview (#235)", async () => {
    vi.stubEnv("VITE_USE_REAL_BUILDER", "true");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        mockResponse(200, {
          dataset_id: "multi",
          previews: [
            {
              source_key: "datago.air",
              status: "failed",
              error: "인증 실패",
              schema: [],
              sample: [],
              total_rows: 0,
              ...requiredPreviewFields(),
            },
            {
              source_key: "kosis.pop",
              status: "ok",
              error: null,
              schema: [{ name: "id", dtype: "string", nullable: false, unique_count: 1 }],
              sample: [{ id: "x" }],
              total_rows: 1,
              ...requiredPreviewFields([{ id: "x" }]),
            },
          ],
        }),
      ),
    );

    const result = await previewBuild(SPEC);

    expect(result.rows).toEqual([{ id: "x" }]);
    expect(result.warnings).toEqual([{ sourceKey: "datago.air", error: "인증 실패" }]);
  });

  it("returns deterministic mock data without network in mock mode", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const result = await previewBuild(SPEC);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.rows.length).toBeGreaterThan(0);
    expect(Object.keys(result.schema).length).toBeGreaterThan(0);
  });
});
