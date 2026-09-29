import { describe, expect, it } from "vitest";
import { generateHtmlExport, generateMarkdownExport, sanitizeFilename } from "./export";
import type { ReportDraft } from "./types";

function makeReport(overrides: Partial<ReportDraft> = {}): ReportDraft {
  return {
    id: "r1",
    title: "테스트 Report",
    datasetId: "air-quality",
    baseRunId: "air-2026-08-14",
    buildSpecDigest: "sha256:air14",
    createdAt: "2026-08-14T08:00:00Z",
    updatedAt: "2026-08-14T08:00:00Z",
    evidenceFetchedAt: "2026-08-14T08:00:00Z",
    version: 1,
    revision: 1,
    evidenceRefs: [],
    blocks: [
      {
        id: "e1",
        provenance: "BUILDER_EVIDENCE",
        section: "quality",
        title: "3. Quality",
        markdown: "availability: `partial` · evaluated_checks: **2**",
        evidenceStatus: "ok",
        createdAt: "x",
        updatedAt: "x",
      },
      {
        id: "k1",
        provenance: "ASSISTANT_INTERPRETATION",
        note: '<script>alert(1)</script> price 결측이 특정 지역에 집중되어 있습니다.',
        reason: "Gold column profile",
        sourceContext: { datasetId: "air-quality", runId: "air-2026-08-14" },
        isSameContext: true,
        generatedAt: "2026-08-14T09:00:00Z",
        provider: "byok",
        createdAt: "x",
        updatedAt: "x",
      },
      { id: "u1", provenance: "USER_CONTENT", heading: "활용 아이디어", markdown: "지역별 분석이 필요합니다.", createdAt: "x", updatedAt: "x" },
    ],
    ...overrides,
  };
}

describe("sanitizeFilename (#258 §12)", () => {
  it("경로/예약 문자를 제거한다", () => {
    expect(sanitizeFilename('a/b\\c:d*e?f"g<h>i|j')).toBe("abcdefghij");
  });

  it("공백은 밑줄로 바꾼다", () => {
    expect(sanitizeFilename("대기질 통합 데이터 report")).toBe("대기질_통합_데이터_report");
  });

  it("빈 제목이면 report로 대체한다", () => {
    expect(sanitizeFilename("///")).toBe("report");
    expect(sanitizeFilename("   ")).toBe("report");
  });
});

describe("generateMarkdownExport / generateHtmlExport (#258 §12, §13)", () => {
  it("Markdown 내보내기에 title/dataset/base run/생성시각/evidence 조회시각을 포함한다", () => {
    const md = generateMarkdownExport(makeReport(), "current");
    expect(md).toContain("테스트 Report");
    expect(md).toContain("Table: air-quality");
    expect(md).toContain("Base Run: air-2026-08-14");
    expect(md).toContain("생성 시각");
    expect(md).toContain("Evidence 조회 시각");
  });

  it("Builder Evidence/AI/사용자 블록을 provenance 태그로 구분한다", () => {
    const md = generateMarkdownExport(makeReport(), "current");
    expect(md).toContain("[Builder Evidence]");
    expect(md).toContain("[AI 작성");
    expect(md).toContain("[사용자 작성]");
  });

  it("stale/orphan 경고를 포함한다", () => {
    const md = generateMarkdownExport(makeReport(), "stale");
    expect(md).toContain("STALE");
  });

  it("HTML 내보내기는 <script> 태그를 절대 포함하지 않는다(Ask KPubData note에 악성 문자열이 있어도)", () => {
    const html = generateHtmlExport(makeReport(), "current");
    expect(html).not.toContain("<script>");
    expect(html.toLowerCase()).not.toContain("<script");
  });

  it("HTML 내보내기는 self-contained 문서이며 provenance 태그를 포함한다", () => {
    const html = generateHtmlExport(makeReport(), "current");
    expect(html).toContain("<!doctype html>");
    expect(html).toContain("Builder Evidence");
    expect(html).toContain("AI 작성");
    expect(html).toContain("사용자 작성");
  });

  it("다른 Run 기준 Ask KPubData 블록은 참고 분석으로 구분해서 내보낸다", () => {
    const report = makeReport({
      blocks: [
        {
          id: "k2",
          provenance: "ASSISTANT_INTERPRETATION",
          note: "다른 run 분석",
          reason: "x",
          sourceContext: { datasetId: "air-quality", runId: "air-2026-08-13" },
          isSameContext: false,
          generatedAt: "2026-08-13T09:00:00Z",
          createdAt: "x",
          updatedAt: "x",
        },
      ],
    });
    const md = generateMarkdownExport(report, "current");
    expect(md).toContain("다른 Run 기준");
    const html = generateHtmlExport(report, "current");
    expect(html).toContain("다른 Run 기준");
  });

  it("BUILDER_EVIDENCE 블록에 summary가 있으면 Markdown export가 summary와 상세 표를 모두 포함한다", () => {
    const report = makeReport({
      blocks: [
        {
          id: "e1",
          provenance: "BUILDER_EVIDENCE",
          section: "quality",
          title: "3. 품질 진단",
          markdown: "| check | result |\n| --- | --- |\n| null_rate | PASS |",
          evidenceStatus: "ok",
          summary: "품질 검사 2건 중 2건 통과했습니다.",
          createdAt: "x",
          updatedAt: "x",
        },
      ],
    });
    const md = generateMarkdownExport(report, "current");
    const summaryIndex = md.indexOf("품질 검사 2건 중 2건 통과했습니다.");
    const detailHeadingIndex = md.indexOf("### 상세 근거");
    const tableIndex = md.indexOf("| check | result |");
    expect(summaryIndex).toBeGreaterThan(-1);
    expect(detailHeadingIndex).toBeGreaterThan(summaryIndex);
    expect(tableIndex).toBeGreaterThan(detailHeadingIndex);
  });

  it("BUILDER_EVIDENCE 블록에 summary가 있으면 HTML export가 escaped summary와 기존 evidence를 모두 포함한다", () => {
    const report = makeReport({
      blocks: [
        {
          id: "e1",
          provenance: "BUILDER_EVIDENCE",
          section: "quality",
          title: "3. 품질 진단",
          markdown: "| check | result |\n| --- | --- |\n| null_rate | PASS |",
          evidenceStatus: "ok",
          summary: "<script>alert(1)</script> 품질 검사 요약",
          createdAt: "x",
          updatedAt: "x",
        },
      ],
    });
    const html = generateHtmlExport(report, "current");
    expect(html).not.toContain("<script>");
    expect(html.toLowerCase()).not.toContain("<script");
    expect(html).toContain("품질 검사 요약");
    const summaryIndex = html.indexOf("품질 검사 요약");
    const detailHeadingIndex = html.indexOf("상세 근거");
    const tableIndex = html.indexOf("null_rate");
    expect(detailHeadingIndex).toBeGreaterThan(summaryIndex);
    expect(tableIndex).toBeGreaterThan(detailHeadingIndex);
  });

  it("summary가 없는 legacy draft(BUILDER_EVIDENCE)는 기존처럼 상세 표만 출력한다", () => {
    const report = makeReport();
    const md = generateMarkdownExport(report, "current");
    expect(md).not.toContain("### 상세 근거");
    expect(md).toContain("availability: `partial` · evaluated_checks: **2**");

    const html = generateHtmlExport(report, "current");
    expect(html).not.toContain("상세 근거");
  });
});
