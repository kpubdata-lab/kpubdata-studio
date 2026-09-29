/**
 * Reports and notes saved before the assistant rename still open (#479).
 *
 * The GitHub Pages demo shares localStorage with anyone who tried it before #461, so
 * the old shapes are planted here exactly as that version wrote them.
 */
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ownedStorageKey } from "@/features/auth/storageOwner";
import { listAssistantReportNotes } from "@/features/assistant/reportInbox";
import { generateMarkdownExport } from "@/features/reports/export";
import { createReport, getReport } from "@/features/reports/repository";
import { ReportEditorPage } from "@/pages/ReportEditorPage";
import { moveLegacyKey } from "@/shared/lib/storageMigration";

const STORE_KEY = ownedStorageKey("kpubdata-studio:reports");

const OLD_ASSISTANT_BLOCK = {
  id: "blk-old",
  provenance: "KUBI_INTERPRETATION",
  createdAt: "2026-09-01T00:00:00Z",
  updatedAt: "2026-09-01T00:00:00Z",
  note: "옛 해석 블록의 본문",
  reason: "옛 근거",
  sourceContext: { datasetId: "air-quality", runId: "air-2026-08-14" },
  isSameContext: true,
  generatedAt: "2026-09-01T00:00:00Z",
};

/** A block from some shape this version never wrote — no markdown, unknown provenance. */
const STRANGE_BLOCK = { id: "blk-x", provenance: "SOMETHING_ELSE", title: "알 수 없는 블록", note: "살아남아야 할 글" };

function plantReport(): string {
  const { report, result } = createReport({
    title: "옛 리포트",
    datasetId: "air-quality",
    baseRunId: "air-2026-08-14",
    buildSpecDigest: null,
    evidenceFetchedAt: "2026-09-01T00:00:00Z",
    blocks: [],
    evidenceRefs: [],
  });
  if (!result.ok) throw new Error(result.reason);
  const envelope = JSON.parse(localStorage.getItem(STORE_KEY) ?? "{}");
  envelope.reports[report.id].blocks = [OLD_ASSISTANT_BLOCK, STRANGE_BLOCK, { provenance: "USER_CONTENT" }, null];
  localStorage.setItem(STORE_KEY, JSON.stringify(envelope));
  return report.id;
}

beforeEach(() => {
  localStorage.clear();
  vi.stubEnv("VITE_USE_REAL_BUILDER", "false");
});

describe("reports saved before the rename (#479)", () => {
  it("read the old assistant block under its new name and keep unknown blocks as text", () => {
    const report = getReport(plantReport())!;
    expect(report.blocks.map((block) => block.provenance)).toEqual([
      "ASSISTANT_INTERPRETATION",
      "USER_CONTENT",
      "USER_CONTENT",
    ]);
    expect(report.blocks[1]).toMatchObject({ heading: "알 수 없는 블록", markdown: "살아남아야 할 글" });
    expect(report.blocks[2]).toMatchObject({ heading: "", markdown: "" });
  });

  it("render without crashing", async () => {
    const id = plantReport();
    render(
      <MemoryRouter initialEntries={[`/reports/${id}`]}>
        <Routes>
          <Route element={<ReportEditorPage />} path="/reports/:reportId" />
        </Routes>
      </MemoryRouter>,
    );
    expect(await screen.findByText("옛 해석 블록의 본문")).toBeInTheDocument();
    expect(screen.getByText("살아남아야 할 글")).toBeInTheDocument();
  });

  it("export without `undefined`", () => {
    const markdown = generateMarkdownExport(getReport(plantReport())!, null);
    expect(markdown).toContain("옛 해석 블록의 본문");
    expect(markdown).not.toContain("undefined");
  });
});

describe("storage keys renamed with the assistant (#479)", () => {
  it("moves notes from the old inbox key to the new one, once", () => {
    const old = ownedStorageKey("kpubdata-studio:kubi-report-inbox");
    localStorage.setItem(
      old,
      JSON.stringify({ version: 1, notes: [{ note: "옛 메모", reason: "r", context: {}, savedAt: "2026-09-01T00:00:00Z" }] }),
    );
    expect(listAssistantReportNotes().map((note) => note.note)).toEqual(["옛 메모"]);
    expect(localStorage.getItem(old)).toBeNull();
  });

  it("moves a persisted value to its new key without overwriting a newer one", () => {
    localStorage.setItem("old", '{"state":{"onboarded":true}}');
    moveLegacyKey("old", "new");
    expect(localStorage.getItem("new")).toBe('{"state":{"onboarded":true}}');
    expect(localStorage.getItem("old")).toBeNull();

    localStorage.setItem("old", "stale");
    moveLegacyKey("old", "new");
    expect(localStorage.getItem("new")).toBe('{"state":{"onboarded":true}}');
    expect(localStorage.getItem("old")).toBeNull();
  });
});
