import { describe, expect, it } from "vitest";
import {
  previewSourceState,
  qualityKubiSeedQuestion,
  summarizeChecksPassed,
  summarizePreviewSources,
} from "./model";
import type { PreviewSource, QualityCheckResult } from "@/shared/lib/builderApi";

function qualityResult(status: QualityCheckResult["status"]): QualityCheckResult {
  return {
    source_key: "s",
    category: "missing",
    rule: "max_null_ratio",
    column: null,
    status,
    actual: 0,
    threshold: null,
    affected_rows: null,
    evaluated_rows: null,
    detail: null,
  };
}

function previewSource(overrides: Partial<PreviewSource> = {}): PreviewSource {
  return {
    source_key: "s",
    status: "ok",
    error: null,
    schema: [],
    sample: [{ a: 1 }],
    total_rows: 1,
    statistics: { row_count: 1, null_counts: {}, duplicate_rate: 0 },
    quality_results: [],
    source_sample: [{ a: 1 }],
    sample_mode: "first",
    diff_available: false,
    diffs: [],
    transform_summary: null,
    diff_truncated: false,
    ...overrides,
  };
}

describe("previewSourceState (#250 §3)", () => {
  it("source.status==='failed'면 failed다", () => {
    expect(previewSourceState(previewSource({ status: "failed", error: "boom" }))).toBe("failed");
  });

  it("정상 응답이지만 total_rows===0이면 zero_rows다(fetch 실패와 구분)", () => {
    expect(previewSourceState(previewSource({ total_rows: 0, sample: [] }))).toBe("zero_rows");
  });

  it("행이 있지만 quality_results가 비어 있으면 not_evaluated다", () => {
    expect(previewSourceState(previewSource({ quality_results: [] }))).toBe("not_evaluated");
  });

  it("행도 있고 quality_results도 있으면 ok다", () => {
    expect(previewSourceState(previewSource({ quality_results: [qualityResult("pass")] }))).toBe("ok");
  });
});

describe("summarizePreviewSources (#250 §3, mixed/partial preview)", () => {
  it("source가 하나면 mixed=false다", () => {
    const { mixed } = summarizePreviewSources([previewSource()]);
    expect(mixed).toBe(false);
  });

  it("모든 source 상태가 같으면 mixed=false다", () => {
    const sources = [
      previewSource({ source_key: "a", quality_results: [qualityResult("pass")] }),
      previewSource({ source_key: "b", quality_results: [qualityResult("pass")] }),
    ];
    expect(summarizePreviewSources(sources).mixed).toBe(false);
  });

  it("source A 성공 + source B 실패면 mixed=true이고 각 source 상태를 잃지 않는다", () => {
    const sources = [
      previewSource({ source_key: "a", quality_results: [qualityResult("pass")] }),
      previewSource({ source_key: "b", status: "failed", error: "network error", total_rows: 0, sample: [] }),
    ];
    const summary = summarizePreviewSources(sources);
    expect(summary.mixed).toBe(true);
    expect(summary.perSource).toHaveLength(2);
    expect(summary.perSource[0]).toMatchObject({ state: "ok" });
    expect(summary.perSource[1]).toMatchObject({ state: "failed" });
  });

  it("source별 0-row/not-evaluated를 구분한다 — 첫 source만 남기고 나머지를 버리지 않는다", () => {
    const sources = [
      previewSource({ source_key: "zero", total_rows: 0, sample: [] }),
      previewSource({ source_key: "unevaluated", quality_results: [] }),
      previewSource({ source_key: "evaluated", quality_results: [qualityResult("warn")] }),
    ];
    const summary = summarizePreviewSources(sources);
    expect(summary.perSource.map((p) => p.state)).toEqual(["zero_rows", "not_evaluated", "ok"]);
    expect(summary.mixed).toBe(true);
  });

  it("aggregate를 임의로 PASS로 추정하지 않는다 — FAIL이 하나라도 있으면 quality.status는 FAIL이다", () => {
    const sources = [
      previewSource({ source_key: "a", quality_results: [qualityResult("pass")] }),
      previewSource({ source_key: "b", quality_results: [qualityResult("fail")] }),
    ];
    const summary = summarizePreviewSources(sources);
    expect(summary.perSource[1].quality.status).toBe("FAIL");
  });
});

describe("qualityKubiSeedQuestion (real Builder E2E — 상태별 seed 질문)", () => {
  it("평가된 check가 없으면(evaluated=0) 규칙 미설정 상태를 묻는다", () => {
    const q = qualityKubiSeedQuestion(summarizeChecksPassed([]));
    expect(q).toContain("평가된 Quality check가 없습니다");
    expect(q).not.toContain("WARN/FAIL의 원인");
  });

  it("모든 check가 PASS면 WARN/FAIL을 전제하지 않고 PASS 근거를 묻는다", () => {
    const q = qualityKubiSeedQuestion(summarizeChecksPassed([qualityResult("pass"), qualityResult("pass")]));
    expect(q).toContain("모든 check가 PASS한 근거");
    expect(q).not.toContain("WARN/FAIL의 원인");
  });

  it("WARN이 있으면 원인/조치 질문을 유지한다", () => {
    const q = qualityKubiSeedQuestion(summarizeChecksPassed([qualityResult("pass"), qualityResult("warn")]));
    expect(q).toContain("WARN/FAIL의 원인과 우선 조치");
  });

  it("FAIL이 있으면 원인/조치 질문을 유지한다", () => {
    const q = qualityKubiSeedQuestion(summarizeChecksPassed([qualityResult("fail")]));
    expect(q).toContain("WARN/FAIL의 원인과 우선 조치");
  });
});
