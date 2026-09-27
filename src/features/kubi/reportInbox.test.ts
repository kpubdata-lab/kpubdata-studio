import { afterEach, describe, expect, it } from "vitest";
import { listKubiReportNotes, queueKubiReportNote, removeKubiReportNote, type KubiReportNote } from "./reportInbox";

afterEach(() => {
  localStorage.clear();
});

function makeNote(overrides: Partial<KubiReportNote> = {}): KubiReportNote {
  return {
    note: "note",
    reason: "reason",
    context: { datasetId: "air-quality", runId: "air-2026-08-14" },
    savedAt: "2026-08-14T09:00:00Z",
    ...overrides,
  };
}

describe("removeKubiReportNote (#258)", () => {
  it("큐에서 값이 일치하는 노트 하나만 제거한다", () => {
    const a = makeNote({ note: "a", savedAt: "2026-08-14T09:00:00Z" });
    const b = makeNote({ note: "b", savedAt: "2026-08-14T09:01:00Z" });
    queueKubiReportNote(a);
    queueKubiReportNote(b);

    removeKubiReportNote(a);

    const remaining = listKubiReportNotes();
    expect(remaining).toHaveLength(1);
    expect(remaining[0].note).toBe("b");
  });

  it("이미 없는 노트를 제거하려 해도 조용히 무시한다", () => {
    queueKubiReportNote(makeNote({ note: "only" }));
    removeKubiReportNote(makeNote({ note: "not-in-queue", savedAt: "2026-08-14T10:00:00Z" }));
    expect(listKubiReportNotes()).toHaveLength(1);
  });
});
