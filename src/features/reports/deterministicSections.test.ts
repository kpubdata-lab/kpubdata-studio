import { afterEach, describe, expect, it } from "vitest";
import { buildDeterministicSections } from "./deterministicSections";
import { fetchReportEvidence } from "./evidence";

afterEach(() => {
  localStorage.clear();
});

describe("buildDeterministicSections (#258 §4, §5)", () => {
  it("Overview/Pipeline/Quality/Schema/Data Summary/Output 6개 섹션을 만든다", async () => {
    const evidence = await fetchReportEvidence("air-quality", "air-2026-08-14");
    const blocks = buildDeterministicSections(evidence);

    expect(blocks.map((b) => b.section)).toEqual(["overview", "pipeline", "quality", "schema", "data_summary", "output"]);
    expect(blocks.every((b) => b.provenance === "BUILDER_EVIDENCE")).toBe(true);
  });

  it("Overview에 BuildSpec digest와 run 시각을 포함한다", async () => {
    const evidence = await fetchReportEvidence("air-quality", "air-2026-08-14");
    const [overview] = buildDeterministicSections(evidence);

    expect(overview.markdown).toContain("sha256:air14");
    expect(overview.markdown).toContain("air-2026-08-14");
  });

  it("Pipeline 섹션은 source별 bronze/silver/gold 상태를 그대로 표시한다(실패도 감춤 없이)", async () => {
    const evidence = await fetchReportEvidence("air-quality", "air-2026-08-14");
    const [, pipeline] = buildDeterministicSections(evidence);

    expect(pipeline.markdown).toContain("datago__air");
    expect(pipeline.markdown).toContain("kma__weather");
    expect(pipeline.markdown).toContain("failed");
    expect(pipeline.evidenceStatus).toBe("ok");
  });

  it("quality availability=unavailable인 run은 PASS/0으로 꾸미지 않고 그대로 확인 불가로 남긴다", async () => {
    const evidence = await fetchReportEvidence("population", "population-2026-08-13");
    const quality = buildDeterministicSections(evidence).find((b) => b.section === "quality")!;

    // "Not considered PASS" explicit negation allowed, but PASS not singled out as representative state.
    // Must keep unavailable.
    expect(quality.markdown).not.toMatch(/summary.*PASS \d/i);
    expect(quality.markdown).toContain("PASS로 간주하지 않습니다");
    expect(quality.markdown).toContain("unavailable");
  });

  it("Quality 섹션은 실제 PASS/WARN/FAIL 결과와 schema drift를 표시한다", async () => {
    const evidence = await fetchReportEvidence("air-quality", "air-2026-08-14");
    const quality = buildDeterministicSections(evidence).find((b) => b.section === "quality")!;

    expect(quality.markdown).toContain("FAIL");
    expect(quality.markdown).toContain("column_removed");
  });

  it("Schema 섹션은 silver schema가 없는 source를 확인할 수 없음으로 구분한다(부분 실패)", async () => {
    const evidence = await fetchReportEvidence("air-quality", "air-2026-08-14");
    const schema = buildDeterministicSections(evidence).find((b) => b.section === "schema")!;

    expect(schema.markdown).toContain("observed_at");
    expect(schema.markdown).toContain("확인할 수 없음");
    expect(schema.evidenceStatus).toBe("partial");
  });

  it("Data Summary는 실제 row_counts/total_row_count를 그대로 사용한다(임의 0 대체 없음)", async () => {
    const evidence = await fetchReportEvidence("air-quality", "air-2026-08-14");
    const dataSummary = buildDeterministicSections(evidence).find((b) => b.section === "data_summary")!;

    expect(dataSummary.markdown).toContain("1,200");
    expect(dataSummary.markdown).toContain("1,000");
  });

  it("Output evidence를 확인할 수 없으면 N/A가 아니라 사유를 포함해 unavailable로 표시한다", async () => {
    const evidence = await fetchReportEvidence("air-quality", "air-2026-08-14");
    const output = buildDeterministicSections(evidence).find((b) => b.section === "output")!;

    expect(output.evidenceStatus).toBe("unavailable");
    expect(output.unavailableReason).toBeTruthy();
  });

  it("dataset 조회 자체가 실패해도 예외를 던지지 않고 unavailable 섹션들을 만든다", async () => {
    const evidence = await fetchReportEvidence("does-not-exist", "does-not-exist-run");
    const blocks = buildDeterministicSections(evidence);

    expect(blocks).toHaveLength(6);
    expect(blocks.find((b) => b.section === "overview")?.evidenceStatus).toBe("unavailable");
  });
});
