/**
 * Page-level coverage for the Reports list/create screen (`/reports`, #668).
 *
 * The report logic modules have their own unit tests; these check how the page puts them
 * together: the loading, empty and error states, opening a saved report, creating one from
 * Builder evidence, and the rename/duplicate/delete actions on the saved list. Real-Builder
 * mode with msw, and a stub `/reports/:reportId` route to see where the page navigates.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useParams } from "react-router-dom";
import { http, HttpResponse, delay } from "msw";
import { mswServer } from "../../vitest.setup";
import { API_BASE } from "@/shared/config/env";
import { queueAssistantReportNote } from "@/features/assistant/reportInbox";
import { createReport, getReport, listReportSummaries } from "@/features/reports/repository";
import { ReportsPage } from "./ReportsPage";

const dataset = (dataset_id: string, title: string) => ({
  dataset_id,
  title,
  sources: [{ provider: "data.go.kr", dataset: dataset_id, alias: dataset_id }],
  latest_run_id: `${dataset_id}-run`,
  status: "ok",
  updated_at: "2026-09-01T00:00:00Z",
  row_counts: {},
  total_row_count: 1,
  stages: {},
  quality: null,
  status_axes: { refresh: "succeeded", completeness: "complete", health: "healthy", access: "available", maturity: "beta" },
});

const run = (run_id: string) => ({
  run_id,
  status: "ok",
  started_at: "2026-09-01T00:00:00Z",
  finished_at: "2026-09-01T00:01:00Z",
  spec_digest: `digest-${run_id}`,
  created_by: null,
});

const DATASETS = [dataset("air", "대기질"), dataset("water", "수질")];

function useBuilder({
  datasets = DATASETS as unknown[],
  runs = { air: [run("air-r2"), run("air-r1")], water: [] } as Record<string, unknown[]>,
  datasetsStatus = 200,
  datasetsDelayMs = 0,
} = {}) {
  mswServer.use(
    http.get(`${API_BASE}/datasets`, async () => {
      if (datasetsDelayMs) await delay(datasetsDelayMs);
      if (datasetsStatus !== 200) {
        return HttpResponse.json({ code: "internal_error", message: "datasets down" }, { status: datasetsStatus });
      }
      return HttpResponse.json({ datasets, total: datasets.length });
    }),
    http.get(`${API_BASE}/datasets/:id/runs`, ({ params }) =>
      HttpResponse.json({ dataset_id: String(params.id), runs: runs[String(params.id)] ?? [] }),
    ),
    // Every other evidence lookup fails; report evidence allows partial failure (#258 §5).
    http.get(/.*/, () => HttpResponse.json({ code: "not_found", message: "none" }, { status: 404 })),
  );
}

function EditorStub() {
  const { reportId } = useParams();
  return <p data-testid="editor-stub">editor:{reportId}</p>;
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/reports"]}>
      <Routes>
        <Route path="/reports" element={<ReportsPage />} />
        <Route path="/reports/:reportId" element={<EditorStub />} />
      </Routes>
    </MemoryRouter>,
  );
}

function seedReport(title: string, datasetId = "air", runId = "air-r1") {
  const { report, result } = createReport({
    title,
    datasetId,
    baseRunId: runId,
    buildSpecDigest: null,
    evidenceFetchedAt: "2026-09-01T00:00:00Z",
    blocks: [],
    evidenceRefs: [],
  });
  expect(result.ok).toBe(true);
  return report;
}

beforeEach(() => {
  vi.stubEnv("VITE_USE_REAL_BUILDER", "true");
  localStorage.clear();
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  localStorage.clear();
});

describe("ReportsPage states", () => {
  it("keeps the table/run pickers and the create button disabled while tables load", async () => {
    useBuilder({ datasetsDelayMs: 300 });
    renderPage();

    expect(screen.getByRole("heading", { name: "리포트" })).toBeInTheDocument();
    expect(screen.getByLabelText("테이블")).toBeDisabled();
    expect(screen.getByLabelText("실행")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Report 만들기" })).toBeDisabled();

    // Once the tables arrive, the first one and its newest run are picked.
    await waitFor(() => expect(screen.getByLabelText("테이블")).toBeEnabled());
    expect(screen.getByLabelText("테이블")).toHaveValue("air");
    await waitFor(() => expect(screen.getByLabelText("실행")).toHaveValue("air-r2"));
    expect(screen.getByRole("button", { name: "Report 만들기" })).toBeEnabled();
  });

  it("shows the empty saved-report state when nothing is stored", async () => {
    useBuilder();
    renderPage();

    expect(await screen.findByText("저장된 Report가 없습니다")).toBeInTheDocument();
    expect(screen.getByText("위에서 테이블/run을 선택해 첫 Report를 만들어보세요.")).toBeInTheDocument();
  });

  it("shows an error instead of the pickers when the table list fails", async () => {
    useBuilder({ datasetsStatus: 500 });
    renderPage();

    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.queryByLabelText("테이블")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Report 만들기" })).not.toBeInTheDocument();
    // The saved list is local and still renders.
    expect(screen.getByText("저장된 Report가 없습니다")).toBeInTheDocument();
  });

  it("says a table has no runs and keeps the create button disabled", async () => {
    useBuilder();
    renderPage();

    await waitFor(() => expect(screen.getByLabelText("테이블")).toBeEnabled());
    fireEvent.change(screen.getByLabelText("테이블"), { target: { value: "water" } });

    expect(await screen.findByText("이 테이블에는 접근 가능한 run이 없습니다.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Report 만들기" })).toBeDisabled();
  });

  it("shows how many assistant notes are waiting", async () => {
    useBuilder();
    queueAssistantReportNote({ note: "n", reason: "r", context: {}, savedAt: "2026-09-01T00:00:00Z" });
    queueAssistantReportNote({ note: "m", reason: "r", context: {}, savedAt: "2026-09-01T00:00:01Z" });
    renderPage();

    expect(await screen.findByText(/참고 노트 2건이 대기 중입니다/)).toBeInTheDocument();
  });
});

describe("ReportsPage list → detail", () => {
  it("lists saved reports and opens one at /reports/:reportId", async () => {
    useBuilder();
    const report = seedReport("대기질 월간 보고");
    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: "대기질 월간 보고" }));

    expect(await screen.findByTestId("editor-stub")).toHaveTextContent(`editor:${report.id}`);
  });

  it("creates a report from the selected table and run and opens it", async () => {
    useBuilder();
    renderPage();

    await waitFor(() => expect(screen.getByLabelText("실행")).toHaveValue("air-r2"));
    fireEvent.click(screen.getByRole("button", { name: "Report 만들기" }));

    const stub = await screen.findByTestId("editor-stub");
    const id = stub.textContent!.replace("editor:", "");
    const saved = getReport(id);
    expect(saved).not.toBeNull();
    expect(saved!.datasetId).toBe("air");
    expect(saved!.baseRunId).toBe("air-r2");
    // The dataset detail lookup failed, so the title falls back to the id rather than inventing one.
    expect(saved!.title).toBe("air · air-r2 보고서");
  });
});

describe("ReportsPage saved-report actions", () => {
  it("renames a report", async () => {
    useBuilder();
    seedReport("옛 제목");
    renderPage();

    const row = (await screen.findByRole("button", { name: "옛 제목" })).closest("li")!;
    fireEvent.click(within(row).getByRole("button", { name: "이름변경" }));
    const input = within(row).getByRole("textbox");
    fireEvent.change(input, { target: { value: "새 제목" } });
    fireEvent.click(within(row).getByRole("button", { name: "저장" }));

    expect(await screen.findByRole("button", { name: "새 제목" })).toBeInTheDocument();
    expect(listReportSummaries().map((s) => s.title)).toEqual(["새 제목"]);
  });

  it("duplicates a report", async () => {
    useBuilder();
    seedReport("원본");
    renderPage();

    const row = (await screen.findByRole("button", { name: "원본" })).closest("li")!;
    fireEvent.click(within(row).getByRole("button", { name: "복제" }));

    await waitFor(() => expect(listReportSummaries()).toHaveLength(2));
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
  });

  it("deletes a report only after confirmation", async () => {
    useBuilder();
    seedReport("지울 보고서");
    const confirm = vi.spyOn(window, "confirm").mockReturnValueOnce(false).mockReturnValueOnce(true);
    renderPage();

    const row = (await screen.findByRole("button", { name: "지울 보고서" })).closest("li")!;
    fireEvent.click(within(row).getByRole("button", { name: "삭제" }));
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "지울 보고서" })).toBeInTheDocument();

    fireEvent.click(within(row).getByRole("button", { name: "삭제" }));
    expect(await screen.findByText("저장된 Report가 없습니다")).toBeInTheDocument();
    expect(listReportSummaries()).toEqual([]);
  });
});
