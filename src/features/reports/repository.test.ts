import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  REPORT_STORE_LIMIT,
  createReport,
  deleteReport,
  duplicateReport,
  getReport,
  hasAnyReport,
  listReportSummaries,
  renameReport,
  saveReport,
} from "./repository";
import type { ReportDraft } from "./types";

function makeInput(overrides: Partial<Parameters<typeof createReport>[0]> = {}) {
  return {
    title: "테스트 Report",
    datasetId: "air-quality",
    baseRunId: "air-2026-08-14",
    buildSpecDigest: "sha256:air14",
    evidenceFetchedAt: "2026-08-14T08:00:00Z",
    blocks: [],
    evidenceRefs: [],
    ...overrides,
  };
}

beforeEach(() => {
  localStorage.clear();
});
afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe("reports repository (#258 §11)", () => {
  it("여러 Report를 각자의 id로 저장하고 목록으로 나열한다", () => {
    const a = createReport(makeInput({ title: "A" }));
    const b = createReport(makeInput({ title: "B" }));
    expect(a.result.ok).toBe(true);
    expect(b.result.ok).toBe(true);
    expect(a.report.id).not.toBe(b.report.id);

    const summaries = listReportSummaries();
    expect(summaries.map((s) => s.title).sort()).toEqual(["A", "B"]);
    expect(hasAnyReport()).toBe(true);
  });

  it("생성 시점의 datasetId/baseRunId를 저장한 뒤 다시 읽어도 그대로 유지한다(run pin)", () => {
    const { report } = createReport(makeInput({ datasetId: "air-quality", baseRunId: "air-2026-08-13" }));
    const reloaded = getReport(report.id);
    expect(reloaded?.datasetId).toBe("air-quality");
    expect(reloaded?.baseRunId).toBe("air-2026-08-13");

    // Even if evidence refilled and saved (e.g., refresh), baseRunId itself persists unless caller changes it.
    saveReport({ ...reloaded!, evidenceFetchedAt: "2026-08-15T00:00:00Z" });
    expect(getReport(report.id)?.baseRunId).toBe("air-2026-08-13");
  });

  it("제목을 바꾼다(rename)", () => {
    const { report } = createReport(makeInput({ title: "원래 제목" }));
    const result = renameReport(report.id, "새 제목");
    expect(result.ok).toBe(true);
    expect(getReport(report.id)?.title).toBe("새 제목");
  });

  it("복제하면 새 id를 갖고 블록/참조는 독립적으로 복사된다(duplicate)", () => {
    const { report } = createReport(
      makeInput({ blocks: [{ id: "b1", provenance: "USER_CONTENT", heading: "h", markdown: "m", createdAt: "x", updatedAt: "x" }] }),
    );
    const outcome = duplicateReport(report.id);
    expect(outcome?.result.ok).toBe(true);
    expect(outcome?.report.id).not.toBe(report.id);
    expect(outcome?.report.blocks).toHaveLength(1);

    // Modifying clone must not affect original (no shared refs).
    const clonedId = outcome!.report.id;
    const cloned = getReport(clonedId)!;
    saveReport({ ...cloned, blocks: [] });
    expect(getReport(report.id)?.blocks).toHaveLength(1);
  });

  it("삭제하면 목록/조회에서 사라진다(delete)", () => {
    const { report } = createReport(makeInput());
    expect(deleteReport(report.id)).toBe(true);
    expect(getReport(report.id)).toBeNull();
    expect(listReportSummaries().find((s) => s.id === report.id)).toBeUndefined();
  });

  it("없는 id를 삭제/이름변경/복제하면 실패를 알린다", () => {
    expect(deleteReport("no-such-id")).toBe(false);
    expect(renameReport("no-such-id", "x").ok).toBe(false);
    expect(duplicateReport("no-such-id")).toBeNull();
  });

  it("낮은 revision으로 저장을 시도하면(다른 탭이 먼저 저장) 거부하고 conflict를 알린다", () => {
    const { report } = createReport(makeInput());
    const reloaded1 = getReport(report.id)!;
    const reloaded2 = getReport(report.id)!;

    // Tab 1 saves first, increments revision.
    const first = saveReport({ ...reloaded1, title: "탭1이 저장" });
    expect(first.ok).toBe(true);

    // Tab 2 holds old revision, attempts save.
    const second = saveReport({ ...reloaded2, title: "탭2가 저장" });
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.conflict).toBe(true);

    // Tab 1 content preserved (not overwritten).
    expect(getReport(report.id)?.title).toBe("탭1이 저장");
  });

  it("force:true면 conflict를 무시하고 덮어쓴다(사용자가 명시적으로 선택했을 때만)", () => {
    const { report } = createReport(makeInput());
    const stale = getReport(report.id)!;
    saveReport({ ...stale, title: "먼저 저장" });

    const forced = saveReport({ ...stale, title: "강제 덮어쓰기" }, { force: true });
    expect(forced.ok).toBe(true);
    expect(getReport(report.id)?.title).toBe("강제 덮어쓰기");
  });

  it("저장소 사용이 불가능하면(quota 초과) 저장된 것처럼 보이지 않고 명시적으로 실패를 알린다", () => {
    const setItemSpy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("quota exceeded", "QuotaExceededError");
    });

    const { result } = createReport(makeInput());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("저장 공간");

    setItemSpy.mockRestore();
  });

  it("저장 가능한 최대 개수를 넘으면 새 Report 저장을 거부한다(자동 삭제하지 않음)", () => {
    for (let i = 0; i < REPORT_STORE_LIMIT; i++) {
      const { result } = createReport(makeInput({ title: `report-${i}` }));
      expect(result.ok).toBe(true);
    }
    const { result: overflow } = createReport(makeInput({ title: "overflow" }));
    expect(overflow.ok).toBe(false);
    expect(listReportSummaries()).toHaveLength(REPORT_STORE_LIMIT);
  });

  it("evidenceRefs/blocks를 저장한 그대로 되돌려준다(provenance 보존)", () => {
    const blocks: ReportDraft["blocks"] = [
      { id: "e1", provenance: "BUILDER_EVIDENCE", section: "overview", title: "1. Overview", markdown: "x", evidenceStatus: "ok", createdAt: "x", updatedAt: "x" },
      { id: "k1", provenance: "KUBI_INTERPRETATION", note: "note", reason: "reason", sourceContext: {}, isSameContext: true, generatedAt: "x", createdAt: "x", updatedAt: "x" },
      { id: "u1", provenance: "USER_CONTENT", heading: "h", markdown: "m", createdAt: "x", updatedAt: "x" },
    ];
    const { report } = createReport(makeInput({ blocks }));
    const reloaded = getReport(report.id)!;
    expect(reloaded.blocks.map((b) => b.provenance)).toEqual(["BUILDER_EVIDENCE", "KUBI_INTERPRETATION", "USER_CONTENT"]);
  });
});
