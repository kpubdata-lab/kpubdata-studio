/**
 * ReportEditorPage 회귀 테스트 (#258, #258 Ask KPubData/legacy summary/sticky sidebar 수정).
 *
 * - Builder evidence 요약 문장이 실제 evidence 값과 일치하는지(0/PASS로 꾸미지 않는지)
 * - summary가 없는 legacy Report도 재조회한 evidence로 요약 문장을 보강해서 보여주는지,
 *   저장된 draft/baseRunId/user·Ask KPubData 블록은 건드리지 않는지, evidence 재조회 실패 시
 *   기존 표시를 그대로 유지하는지
 * - 상세 evidence 표가 여전히 존재하고 펼칠 수 있는지
 * - Ask KPubData/Builder 블록이 시각적으로 구분되는지
 * - Report Context sidebar가 실제 값만 보여주고, desktop에서 sticky로 고정되는지
 * - STALE이어도 baseRunId가 자동으로 바뀌지 않는지
 * - "7. Ask KPubData 분석"이 Reports 전용 축소 UX(기본 CTA/quick action, BYOK/채팅은 펼쳐야만 노출,
 *   global drawer 미사용, Report 고정 dataset/run, 승인 전 미저장)로 동작하는지
 * - 좁은 viewport에서 sidebar가 아래로 collapse하는 반응형 grid recipe가 그대로인지
 * - PDF/DOCX CTA가 없는지
 */
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAssistConfig } from "@/features/assistant/config";
import { useKubiStore } from "@/features/kubi/useKubiSession";
import { buildDeterministicSections } from "@/features/reports/deterministicSections";
import * as reportEvidenceApi from "@/features/reports/evidence";
import { buildEvidenceRefs, fetchReportEvidence } from "@/features/reports/evidence";
import { createReport, getReport, saveReport } from "@/features/reports/repository";
import type { BuilderEvidenceBlock, KubiInterpretationBlock, ReportDraft } from "@/features/reports/types";
import { listKubiReportNotes, queueKubiReportNote } from "@/features/kubi/reportInbox";
import { ReportEditorPage } from "@/pages/ReportEditorPage";
import { useUIStore } from "@/shared/hooks/useUIStore";

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location">{location.pathname + location.search}</div>;
}

function renderReport(reportId: string) {
  return render(
    <MemoryRouter initialEntries={[`/reports/${reportId}`]}>
      <LocationProbe />
      <Routes>
        <Route path="/reports/:reportId" element={<ReportEditorPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

async function makeReport(datasetId: string, runId: string, titlePrefix = "테스트"): Promise<ReportDraft> {
  const evidence = await fetchReportEvidence(datasetId, runId);
  const blocks = buildDeterministicSections(evidence);
  const evidenceRefs = buildEvidenceRefs(evidence);
  const { report, result } = createReport({
    title: `${titlePrefix} · ${runId}`,
    datasetId,
    baseRunId: runId,
    buildSpecDigest: evidence.run.ok ? evidence.run.value.spec_digest : null,
    evidenceFetchedAt: evidence.fetchedAt,
    blocks,
    evidenceRefs,
  });
  if (!result.ok) throw new Error(result.reason);
  return report;
}

/** 저장된 BUILDER_EVIDENCE 블록에서 `summary`를 지워 "summary 추가 전에 저장된 legacy draft"를 흉내낸다. */
function stripSummary(block: ReportDraft["blocks"][number]): ReportDraft["blocks"][number] {
  if (block.provenance !== "BUILDER_EVIDENCE") return block;
  const clone: Partial<BuilderEvidenceBlock> = { ...block };
  delete clone.summary;
  return clone as BuilderEvidenceBlock;
}

function makeKubiBlock(overrides: Partial<KubiInterpretationBlock> = {}): KubiInterpretationBlock {
  const now = new Date().toISOString();
  return {
    id: "kubi-1",
    provenance: "KUBI_INTERPRETATION",
    note: "가격 결측이 특정 지역에 집중됩니다.",
    reason: "품질 이슈 참고용",
    sourceContext: { datasetId: "air-quality", runId: "air-2026-08-14" },
    isSameContext: true,
    generatedAt: now,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

beforeEach(() => {
  localStorage.clear();
  useUIStore.setState({ isKubiDrawerOpen: false });
  useKubiStore.setState({ turns: [], onboarded: false, pendingSeed: null });
  useAssistConfig.getState().clear();
});

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe("ReportEditorPage IA 개편 (#258)", () => {
  it("Builder evidence 요약 문장이 실제 PASS/FAIL 수치와 동일하게 표시된다", async () => {
    const report = await makeReport("air-quality", "air-2026-08-14");
    renderReport(report.id);

    await screen.findByText(/이 보고서는/);
    expect(screen.getByText(/1건은 PASS/)).toBeInTheDocument();
    expect(screen.getByText(/1건은 FAIL/)).toBeInTheDocument();
    expect(screen.queryByText(/0건은 WARN/)).not.toBeInTheDocument();
  });

  it("unavailable evidence를 0/PASS로 문장화하지 않는다", async () => {
    const report = await makeReport("population", "population-2026-08-13");
    renderReport(report.id);

    await screen.findByText(/PASS로 간주하지 않습니다/);
    expect(screen.queryByText(/\d건은 PASS/)).not.toBeInTheDocument();
  });

  it("상세 evidence 표는 지워지지 않고 펼쳐서 볼 수 있다", async () => {
    const report = await makeReport("air-quality", "air-2026-08-14");
    renderReport(report.id);

    const schemaBlock = await screen.findByTestId("block-schema");
    // dtype(datetime)은 요약 문장이 아니라 상세 표에만 있다 — 펼치기 전에는 없어야 한다.
    expect(within(schemaBlock).queryByText("datetime")).not.toBeInTheDocument();

    fireEvent.click(within(schemaBlock).getByText("상세 근거 보기"));
    expect(await within(schemaBlock).findByText("datetime")).toBeInTheDocument();
  });

  it("Ask KPubData 블록과 Builder Evidence 블록이 provenance 배지로 시각적으로 구분된다", async () => {
    let report = await makeReport("air-quality", "air-2026-08-14");
    report = { ...report, blocks: [...report.blocks, makeKubiBlock()] };
    saveReport(report, { force: true });

    renderReport(report.id);

    await screen.findByTestId("block-kubi");
    expect(screen.getByText("Ask KPubData 분석 · AI 작성")).toBeInTheDocument();
    expect(screen.getAllByText("Builder Evidence").length).toBeGreaterThan(0);
    expect(screen.getByText("AI 작성 · Ask KPubData")).toBeInTheDocument();
  });

  it("Report Context sidebar가 실제 base dataset/run/evidence 상태를 보여준다", async () => {
    const report = await makeReport("air-quality", "air-2026-08-14");
    renderReport(report.id);

    const contextHeading = await screen.findByText("Report Context");
    const contextCard = contextHeading.parentElement as HTMLElement;
    expect(within(contextCard).getByText("air-quality")).toBeInTheDocument();
    expect(within(contextCard).getByText("air-2026-08-14")).toBeInTheDocument();
    await screen.findByText(/CURRENT/);
  });

  it("STALE이어도 baseRunId를 자동으로 바꾸지 않는다(최신 run 자동 전환 금지)", async () => {
    // air-2026-08-13은 최신이 아니다(최신은 air-2026-08-14) → STALE 판정이 나와야 한다.
    const report = await makeReport("air-quality", "air-2026-08-13");
    renderReport(report.id);

    await screen.findByText(/STALE/);
    expect(getReport(report.id)?.baseRunId).toBe("air-2026-08-13");

    // "다시 확인"을 눌러도 마찬가지다.
    fireEvent.click(screen.getByRole("button", { name: "다시 확인" }));
    await waitFor(() => expect(screen.getByText(/STALE/)).toBeInTheDocument());
    expect(getReport(report.id)?.baseRunId).toBe("air-2026-08-13");
  });

  it("좁은 viewport에서 sidebar가 아래로 collapse하는 반응형 grid를 그대로 유지한다", async () => {
    const report = await makeReport("air-quality", "air-2026-08-14");
    renderReport(report.id);

    const grid = await screen.findByTestId("report-layout-grid");
    expect(grid.className).toContain("grid-cols-1");
    expect(grid.className).toMatch(/lg:grid-cols-\[/);
  });

  it("PDF/DOCX 다운로드 CTA를 제공하지 않는다", async () => {
    const report = await makeReport("air-quality", "air-2026-08-14");
    renderReport(report.id);

    await screen.findByText(/이 보고서는/);
    expect(screen.queryByText(/PDF/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/DOCX/i)).not.toBeInTheDocument();
  });
});

describe("ReportEditorPage — legacy summary 보강 (#258 legacy summary 수정)", () => {
  it("summary 없는 legacy draft를 다시 열면 현재 evidence 기준 요약 문장이 화면에 보강되고, 저장된 draft/baseRunId/블록은 그대로 유지된다", async () => {
    const report = await makeReport("air-quality", "air-2026-08-14");
    const legacyBlocks = [...report.blocks.map(stripSummary), makeKubiBlock()];
    saveReport({ ...report, blocks: legacyBlocks }, { force: true });

    // 저장된 draft 자체에는 summary가 없다.
    const overviewBefore = getReport(report.id)?.blocks.find(
      (block): block is BuilderEvidenceBlock => block.provenance === "BUILDER_EVIDENCE" && block.section === "overview",
    );
    expect(overviewBefore?.summary).toBeUndefined();

    renderReport(report.id);

    // 화면에는 재조회한 evidence 기준 요약 문장이 보강되어 보인다.
    await screen.findByText(/이 보고서는/);

    // baseRunId는 그대로다.
    expect(getReport(report.id)?.baseRunId).toBe("air-2026-08-14");
    // 저장된 draft 자체는 임의로 migration하지 않는다(저장을 강제하지 않음).
    const overviewAfter = getReport(report.id)?.blocks.find(
      (block): block is BuilderEvidenceBlock => block.provenance === "BUILDER_EVIDENCE" && block.section === "overview",
    );
    expect(overviewAfter?.summary).toBeUndefined();
    // 기존 Ask KPubData 블록은 보존된다.
    expect(screen.getByTestId("block-kubi")).toBeInTheDocument();
  });

  it("evidence 재조회에 실패하면 legacy draft를 그대로 유지한다(요약 문장을 지어내지 않음)", async () => {
    const report = await makeReport("air-quality", "air-2026-08-14");
    const legacyBlocks = report.blocks.map(stripSummary);
    saveReport({ ...report, blocks: legacyBlocks }, { force: true });

    vi.spyOn(reportEvidenceApi, "fetchReportEvidence").mockRejectedValueOnce(new Error("network down"));

    renderReport(report.id);

    // 상세 표(overview 블록)는 그대로 보인다.
    await screen.findByTestId("block-overview");
    // 요약 문장은 생성되지 않는다 — 실패했다고 0/PASS 등으로 지어내지 않는다.
    expect(screen.queryByText(/이 보고서는/)).not.toBeInTheDocument();
  });
});

describe("ReportEditorPage — Report Context sidebar sticky (#258 sticky sidebar 수정)", () => {
  it("desktop(lg 이상)에서 sidebar wrapper가 sticky로 고정된다", async () => {
    const report = await makeReport("air-quality", "air-2026-08-14");
    renderReport(report.id);

    const wrapper = await screen.findByTestId("report-context-sidebar-wrapper");
    expect(wrapper.className).toContain("lg:sticky");
    expect(wrapper.className).toMatch(/lg:top-/);
    expect(wrapper.className).toContain("lg:self-start");
  });

  it("좁은 viewport 1단 grid 안에서도 같은 wrapper를 그대로 쓴다(sticky는 lg: prefix로만 걸려 좁은 화면에서는 해제된다)", async () => {
    const report = await makeReport("air-quality", "air-2026-08-14");
    renderReport(report.id);

    const grid = await screen.findByTestId("report-layout-grid");
    const wrapper = await screen.findByTestId("report-context-sidebar-wrapper");
    expect(grid).toContainElement(wrapper);
    // sticky/self-start 클래스가 lg: 없이 기본으로 걸려있지 않아야 한다(모바일에서는 해제).
    expect(wrapper.className).not.toMatch(/(^|\s)sticky(\s|$)/);
    expect(wrapper.className).not.toMatch(/(^|\s)self-start(\s|$)/);
  });
});

describe("ReportEditorPage — 7. Ask KPubData 분석 (#258 Ask KPubData Report UX 수정)", () => {
  it("기본 상태에서는 전체 BYOK/채팅 form을 바로 노출하지 않는다", async () => {
    const report = await makeReport("air-quality", "air-2026-08-14");
    renderReport(report.id);

    await screen.findByTestId("kubi-report-panel");
    expect(screen.queryByLabelText("API Key")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Ask KPubData 에 질문하기")).not.toBeInTheDocument();
    expect(screen.queryByText("데모 질문 보내보기")).not.toBeInTheDocument();
  });

  it("Primary CTA와 4개의 quick action이 존재한다(기본 mock 모드에서는 CTA가 데모 문구로 표시된다)", async () => {
    const report = await makeReport("air-quality", "air-2026-08-14");
    renderReport(report.id);

    await screen.findByTestId("kubi-report-panel");
    expect(screen.getByRole("button", { name: "데모 보고서 분석 생성" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "품질 문제 해석" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Pipeline 실패 원인 분석" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "데이터 활용 아이디어" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "주의사항·한계 작성" })).toBeInTheDocument();
  });

  it("BYOK가 설정되면 Primary CTA 문구가 '보고서용 AI 분석 생성'으로 바뀐다", async () => {
    useAssistConfig.getState().setConfig({ apiKey: "sk-test", model: "gpt-4o-mini", baseUrl: "" });
    const report = await makeReport("air-quality", "air-2026-08-14");
    renderReport(report.id);

    await screen.findByTestId("kubi-report-panel");
    expect(screen.getByRole("button", { name: "보고서용 AI 분석 생성" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "데모 보고서 분석 생성" })).not.toBeInTheDocument();
  });

  it("mock 모드에서는 '실제 AI 분석이 아닌 mock 응답입니다.' 문구가 표시된다", async () => {
    const report = await makeReport("air-quality", "air-2026-08-14");
    renderReport(report.id);

    await screen.findByTestId("kubi-report-panel");
    expect(screen.getByText("실제 AI 분석이 아닌 mock 응답입니다.")).toBeInTheDocument();
  });

  it("AI 설정을 누르면 BYOK 설정 form이 펼쳐진다", async () => {
    const report = await makeReport("air-quality", "air-2026-08-14");
    renderReport(report.id);

    await screen.findByTestId("kubi-report-panel");
    expect(screen.queryByLabelText("API Key")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "AI 설정" }));
    expect(screen.getByLabelText("API Key")).toBeInTheDocument();
  });

  it("직접 질문하기를 누르면 기존 KubiContent 채팅이 펼쳐지고, global Ask KPubData drawer는 열리지 않는다", async () => {
    const report = await makeReport("air-quality", "air-2026-08-14");
    renderReport(report.id);

    await screen.findByTestId("kubi-report-panel");
    fireEvent.click(screen.getByRole("button", { name: "직접 질문하기" }));

    const chat = await screen.findByTestId("kubi-report-chat");
    expect(within(chat).getByLabelText("Ask KPubData 에 질문하기")).toBeInTheDocument();
    expect(useUIStore.getState().isKubiDrawerOpen).toBe(false);
  });

  it("이 문제 설명 보기 패널은 Report가 고정한 dataset/baseRunId를 context로 유지한다(최신 run 자동 전환 금지)", async () => {
    // air-2026-08-13은 최신이 아니다(최신은 air-2026-08-14) — STALE 상태에서도 이 값을 써야 한다.
    const report = await makeReport("air-quality", "air-2026-08-13");
    renderReport(report.id);

    await screen.findByTestId("kubi-report-panel");
    await waitFor(() => {
      expect(screen.getByTestId("location").textContent).toContain("dataset=air-quality");
    });
    expect(screen.getByTestId("location").textContent).toContain("run=air-2026-08-13");
    expect(screen.getByTestId("location").textContent).not.toContain("air-2026-08-14");
  });

  it("생성 → 미리보기까지는 Report에 아무것도 저장하지 않고, '보고서에 추가'를 눌러야 KUBI_INTERPRETATION 블록이 추가된다", async () => {
    const report = await makeReport("air-quality", "air-2026-08-14");
    renderReport(report.id);

    await screen.findByTestId("kubi-report-panel");
    // 질문을 보내기 전에 URL이 Report 기준 dataset/run으로 이미 고정되어 있는지 먼저 기다린다
    // (그렇지 않으면 turn의 context가 비어 있는 채로 생성되어 미리보기가 이 Report와 매칭되지
    // 않는다 — KubiReportPanel의 useEffect가 그 값을 채운다).
    await waitFor(() => {
      expect(screen.getByTestId("location").textContent).toContain("dataset=air-quality");
    });

    fireEvent.click(screen.getByRole("button", { name: "데모 보고서 분석 생성" }));

    const preview = await screen.findByTestId("kubi-report-preview");
    // 승인 전에는 Report에 저장되지 않는다.
    expect(screen.queryByTestId("block-kubi")).not.toBeInTheDocument();
    expect(getReport(report.id)?.blocks.some((block) => block.provenance === "KUBI_INTERPRETATION")).toBe(false);

    fireEvent.click(within(preview).getByRole("button", { name: "보고서에 추가" }));

    const kubiBlock = await screen.findByTestId("block-kubi");
    // note 본문(생성된 분석 답변) 자체가 그대로 반영됐는지 확인한다 — "판단 근거" 줄과는 다른 문구를 쓴다.
    expect(within(kubiBlock).getByText(/mock 데이터 기반 예시 응답입니다/)).toBeInTheDocument();
    expect(getReport(report.id)?.blocks.some((block) => block.provenance === "KUBI_INTERPRETATION")).toBe(true);
  });

  it("대기 중인 참고 노트를 승인하면 기존 동작대로 KUBI_INTERPRETATION 블록이 추가된다(ADD_REPORT_BLOCK 승인 흐름 유지)", async () => {
    const report = await makeReport("air-quality", "air-2026-08-14");
    queueKubiReportNote({
      note: "가격 결측이 특정 지역에 집중됩니다.",
      reason: "품질 이슈 참고용",
      context: { datasetId: "air-quality", runId: "air-2026-08-14" },
      savedAt: new Date().toISOString(),
    });

    renderReport(report.id);

    const addButton = await screen.findByRole("button", { name: "이 Report에 추가" });
    fireEvent.click(addButton);

    const kubiBlock = await screen.findByTestId("block-kubi");
    expect(within(kubiBlock).getByText(/가격 결측이 특정 지역에 집중됩니다\./)).toBeInTheDocument();
    expect(listKubiReportNotes()).toHaveLength(0);
  });
});
