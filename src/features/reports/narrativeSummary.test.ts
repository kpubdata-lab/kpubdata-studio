// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { fetchReportEvidence } from "./evidence";
import {
  buildDataSummarySummary,
  buildOutputSummary,
  buildOverviewSummary,
  buildPipelineSummary,
  buildQualitySummary,
  buildSchemaSummary,
  computeQualityCounts,
} from "./narrativeSummary";

afterEach(() => {
  localStorage.clear();
});

describe("narrativeSummary (#258 IA 개편)", () => {
  describe("buildOverviewSummary", () => {
    it("실제 evidence 값(제목/run id/provider/run 상태)만으로 문장을 만든다", async () => {
      const evidence = await fetchReportEvidence("air-quality", "air-2026-08-14");
      const summary = buildOverviewSummary(evidence);

      expect(summary).toContain("대기질 통합 데이터");
      expect(summary).toContain("air-2026-08-14");
      expect(summary).toContain("datago");
      expect(summary).toContain("kma");
      expect(summary).toContain("failed");
    });

    it("dataset 조회가 실패하면 개요를 요약할 수 없다고 말하고 값을 지어내지 않는다", async () => {
      const evidence = await fetchReportEvidence("does-not-exist", "does-not-exist-run");
      const summary = buildOverviewSummary(evidence);
      expect(summary).toContain("요약할 수 없습니다");
      expect(summary).not.toMatch(/제공자의 소스로 구성되어 있습니다\.\s*$/);
    });
  });

  describe("buildPipelineSummary", () => {
    it("실패한 source는 실패 사실과 다음 단계 미실행을 그대로 문장화한다", async () => {
      const evidence = await fetchReportEvidence("air-quality", "air-2026-08-14");
      const summary = buildPipelineSummary(evidence);

      expect(summary).toContain("datago__air");
      expect(summary).toContain("kma__weather");
      expect(summary).toContain("Silver 단계에서 실패하여 Gold 단계가 실행되지 않았습니다");
      expect(summary).toContain("Bronze → Silver → Gold까지 모두 정상 처리되었습니다");
    });
  });

  describe("buildQualitySummary / computeQualityCounts", () => {
    it("실제 PASS/FAIL 건수와 개별 결과를 문장으로 만든다(WARN 0건은 생략)", async () => {
      const evidence = await fetchReportEvidence("air-quality", "air-2026-08-14");
      const summary = buildQualitySummary(evidence);
      const counts = computeQualityCounts(evidence);

      expect(counts).toEqual({ pass: 1, warn: 0, fail: 1, evaluated: 2 });
      expect(summary).toContain("총 2건의 품질 검사가 평가되었습니다");
      expect(summary).toContain("1건은 PASS");
      expect(summary).toContain("1건은 FAIL");
      expect(summary).not.toContain("0건은 WARN");
      // Actual per-rule descriptions: pm10 missing-rate PASS, temperature required-column FAIL
      expect(summary).toContain("pm10");
      expect(summary).toContain("1.0%");
      expect(summary).toContain("temperature");
      expect(summary).toContain("확인되지 않아 FAIL했습니다");
    });

    it("quality availability=unavailable이면 PASS/0으로 꾸미지 않고 counts도 채우지 않는다", async () => {
      const evidence = await fetchReportEvidence("population", "population-2026-08-13");
      const summary = buildQualitySummary(evidence);
      const counts = computeQualityCounts(evidence);

      expect(summary).toContain("PASS로 간주하지 않습니다");
      expect(summary).not.toMatch(/\d건은 PASS/);
      expect(counts).toBeNull();
    });

    it("quality 조회 자체가 실패하면 counts를 채우지 않는다", async () => {
      const evidence = await fetchReportEvidence("does-not-exist", "does-not-exist-run");
      expect(computeQualityCounts(evidence)).toBeNull();
      expect(buildQualitySummary(evidence)).toContain("불러오지 못해");
    });
  });

  describe("buildSchemaSummary", () => {
    it("silver schema가 있는 source는 컬럼명을 나열하고, 없는 source는 확인 불가로 구분한다", async () => {
      const evidence = await fetchReportEvidence("air-quality", "air-2026-08-14");
      const summary = buildSchemaSummary(evidence);

      expect(summary).toContain("observed_at");
      expect(summary).toContain("value");
      expect(summary).toContain("kma__weather");
      expect(summary).toContain("해당 단계의 스키마를 확인할 수 없습니다");
    });
  });

  describe("buildDataSummarySummary", () => {
    it("실제 total_row_count/row_counts만 사용하고 0으로 대체하지 않는다", async () => {
      const evidence = await fetchReportEvidence("air-quality", "air-2026-08-14");
      const summary = buildDataSummarySummary(evidence);

      expect(summary).toContain("1,200건");
      expect(summary).toContain("1,000건");
      expect(summary).toContain("200건");
    });

    it("dataset 조회가 실패하면 0건이 아니라 확인할 수 없다고 말한다", async () => {
      const evidence = await fetchReportEvidence("does-not-exist", "does-not-exist-run");
      const summary = buildDataSummarySummary(evidence);
      expect(summary).not.toContain("0건");
      expect(summary).toContain("확인할 수 없");
    });
  });

  describe("buildOutputSummary", () => {
    it("mock/demo 모드에서는 output을 확인할 수 없다고 말하고 같은 경고를 두 번 반복하지 않는다", async () => {
      const evidence = await fetchReportEvidence("air-quality", "air-2026-08-14");
      const summary = buildOutputSummary(evidence);

      expect(summary).toContain("Output 확인 불가");
      // "cannot verify" appears once only (no duplicate warnings, #258 IA redesign §4).
      const occurrences = summary.split("확인").length - 1;
      expect(occurrences).toBeLessThanOrEqual(2);
    });
  });
});
