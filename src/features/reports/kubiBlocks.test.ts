import { describe, expect, it } from "vitest";
import type { KubiReportNote } from "@/features/kubi/reportInbox";
import { noteMatchesReportContext, reportNoteToBlock } from "./kubiBlocks";

function makeNote(overrides: Partial<KubiReportNote> = {}): KubiReportNote {
  return {
    note: "price 결측 1.8%가 특정 지역에 집중되어 있습니다.",
    reason: "Gold column profile 기준",
    context: { datasetId: "air-quality", runId: "air-2026-08-14", stage: "gold" },
    savedAt: "2026-08-14T09:00:00Z",
    ...overrides,
  };
}

describe("reportNoteToBlock / noteMatchesReportContext (#258 §6, §7)", () => {
  it("같은 dataset/run 문맥이면 isSameContext=true로 정본 문맥임을 표시한다", () => {
    const note = makeNote();
    const block = reportNoteToBlock(note, { datasetId: "air-quality", baseRunId: "air-2026-08-14" });

    expect(block.provenance).toBe("KUBI_INTERPRETATION");
    expect(block.isSameContext).toBe(true);
    expect(noteMatchesReportContext(note, { datasetId: "air-quality", baseRunId: "air-2026-08-14" })).toBe(true);
  });

  it("다른 run에서 만든 note는 isSameContext=false로 남겨 참고 분석임을 구분한다(정본처럼 합치지 않음)", () => {
    const note = makeNote({ context: { datasetId: "air-quality", runId: "air-2026-08-13" } });
    const block = reportNoteToBlock(note, { datasetId: "air-quality", baseRunId: "air-2026-08-14" });

    expect(block.isSameContext).toBe(false);
    expect(block.sourceContext.runId).toBe("air-2026-08-13");
  });

  it("note/reason/생성시각을 그대로 보존한다(LLM 원문을 임의로 바꾸지 않음)", () => {
    const note = makeNote();
    const block = reportNoteToBlock(note, { datasetId: "air-quality", baseRunId: "air-2026-08-14" });

    expect(block.note).toBe(note.note);
    expect(block.reason).toBe(note.reason);
    expect(block.generatedAt).toBe(note.savedAt);
  });
});
