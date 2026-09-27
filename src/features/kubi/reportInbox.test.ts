import { afterEach, describe, expect, it } from "vitest";
import { listAsk KPubDataReportNotes, queueAsk KPubDataReportNote, removeAsk KPubDataReportNote, type Ask KPubDataReportNote } from "./reportInbox";

afterEach(() => {
  localStorage.clear();
});

function makeNote(overrides: Partial<Ask KPubDataReportNote> = {}): Ask KPubDataReportNote {
  return {
    note: "note",
    reason: "reason",
    context: { datasetId: "air-quality", runId: "air-2026-08-14" },
    savedAt: "2026-08-14T09:00:00Z",
    ...overrides,
  };
}

describe("removeAsk KPubDataReportNote (#258)", () => {
  it("큐에서 값이 일치하는 노트 하나만 제거한다", () => {
    const a = makeNote({ note: "a", savedAt: "2026-08-14T09:00:00Z" });
    const b = makeNote({ note: "b", savedAt: "2026-08-14T09:01:00Z" });
    queueAsk KPubDataReportNote(a);
    queueAsk KPubDataReportNote(b);

    removeAsk KPubDataReportNote(a);

    const remaining = listAsk KPubDataReportNotes();
    expect(remaining).toHaveLength(1);
    expect(remaining[0].note).toBe("b");
  });

  it("이미 없는 노트를 제거하려 해도 조용히 무시한다", () => {
    queueAsk KPubDataReportNote(makeNote({ note: "only" }));
    removeAsk KPubDataReportNote(makeNote({ note: "not-in-queue", savedAt: "2026-08-14T10:00:00Z" }));
    expect(listAsk KPubDataReportNotes()).toHaveLength(1);
  });
});
