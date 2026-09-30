/**
 * Quality Center: actionable quality issues across tables in one table (#536), read with
 * one `GET /quality/issues` call (#568, kpubdata-builder#843).
 *
 * Mock fixture: air-quality's latest run has a FAIL and a schema drift finding and is
 * partial, population's latest run evaluated nothing, transport's latest run all passed.
 */
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MOCK_DATASETS, MOCK_QUALITY } from "@/features/datasets/api/mockData";
import { QualityPage } from "@/pages/QualityPage";
import { ApiError, builderApi } from "@/shared/lib/builderApi";

const CAPTION = "테이블별 조치가 필요한 품질 문제";

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location">{location.pathname}{location.search}</output>;
}

function renderQuality(initialEntry = "/quality") {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <LocationProbe />
      <Routes><Route path="/quality" element={<QualityPage />} /></Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.stubEnv("VITE_USE_REAL_BUILDER", "false");
});
afterEach(() => vi.unstubAllEnvs());

describe("Quality Center across tables (#536)", () => {
  it("lists WARN/FAIL results and schema drift from every table's latest refresh in one table", async () => {
    renderQuality();

    const table = await screen.findByRole("table", { name: CAPTION });
    const headers = within(table).getAllByRole("columnheader").map((cell) => cell.textContent);
    expect(headers).toEqual(["테이블", "소스", "규칙", "컬럼", "상태", "실제값 / 기준", "영향 행 / 검사 행", "스냅샷(run)"]);

    const fail = within(table).getByRole("row", { name: /required_column/ });
    expect(fail).toHaveTextContent("대기질 통합 데이터");
    expect(fail).toHaveTextContent("kma__weather");
    expect(fail).toHaveTextContent("temperature");
    expect(within(fail).getByText("FAIL").closest("[data-status]")).toHaveAttribute("data-status", "actionable");
    expect(within(fail).getByRole("link", { name: "air-2026-08-14" })).toHaveAttribute("href", "/refresh-jobs/air-2026-08-14");
    expect(within(fail).getByRole("link", { name: "대기질 통합 데이터" })).toHaveAttribute(
      "href",
      "/tables/air-quality?run=air-2026-08-14&source=kma__weather&tab=quality",
    );

    const drift = within(table).getByRole("row", { name: /column_removed/ });
    expect(within(drift).getByText("Schema drift").closest("[data-status]")).toHaveAttribute("data-status", "actionable");

    // PASS results are not issues.
    expect(within(table).queryByText("seoul__transport")).not.toBeInTheDocument();
  });

  it("has no KPI cards, legend or run/source/stage pickers — that is Table Detail's Quality tab", async () => {
    renderQuality();
    await screen.findByRole("table", { name: CAPTION });
    expect(screen.queryByText("Checks Passed")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Run 선택")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Source 선택")).not.toBeInTheDocument();
    expect(screen.getByLabelText("상태")).toBeInTheDocument();
    expect(screen.getByLabelText("테이블")).toBeInTheDocument();
    expect(screen.getByLabelText("분류")).toBeInTheDocument();
  });

  it("does not count a refresh with nothing evaluated (N/A) as passed", async () => {
    renderQuality();
    const coverage = await screen.findByTestId("quality-coverage");
    // Builder's coverage, as sent: partial and N/A are their own counts, never passes.
    expect(coverage).toHaveTextContent(
      "테이블 3개 — 평가됨 1 · 일부만 평가 1 · 평가 안 됨(N/A) 1 · 읽지 못함 0. 조치가 필요한 문제 2건 (테이블 1개).",
    );
    expect(screen.getByText(/평가 결과가 없는 테이블 1개\(N\/A\) — 통과로 세지 않습니다/)).toBeInTheDocument();
    expect(screen.getByText(/일부 소스만 평가된 테이블 1개\(partial\)/)).toBeInTheDocument();
  });

  it("filters by status, table and category and keeps the filters in the URL", async () => {
    renderQuality();
    const table = await screen.findByRole("table", { name: CAPTION });
    expect(within(table).getAllByRole("row")).toHaveLength(3);

    fireEvent.change(screen.getByLabelText("상태"), { target: { value: "drift" } });
    await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent("status=drift"));
    expect(within(screen.getByRole("table", { name: CAPTION })).getAllByRole("row")).toHaveLength(2);
    expect(screen.getByRole("row", { name: /column_removed/ })).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("상태"), { target: { value: "" } });
    fireEvent.change(screen.getByLabelText("분류"), { target: { value: "schema" } });
    await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent("category=schema"));
    expect(screen.getByRole("row", { name: /required_column/ })).toBeInTheDocument();
    expect(screen.queryByRole("row", { name: /column_removed/ })).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("분류"), { target: { value: "" } });
    fireEvent.change(screen.getByLabelText("테이블"), { target: { value: "air-quality" } });
    await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent("dataset=air-quality"));
    expect(within(screen.getByRole("table", { name: CAPTION })).getAllByRole("row")).toHaveLength(3);
  });

  it("keeps a visible table without issues from the URL as a filter with no rows", async () => {
    renderQuality("/quality?dataset=transport");
    expect(await screen.findByText("필터에 맞는 품질 문제가 없습니다.")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByLabelText("테이블")).toHaveValue("transport"));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("points an older run from a link to Table Detail instead of silently showing the latest", async () => {
    renderQuality("/quality?dataset=air-quality&run=air-2026-08-13&source=kma__weather");
    const note = await screen.findByRole("note");
    expect(note).toHaveTextContent("air-2026-08-13");
    expect(within(note).getByRole("link")).toHaveAttribute("href", "/tables/air-quality?run=air-2026-08-13&source=kma__weather&tab=quality");
    expect(screen.getByLabelText("테이블")).toHaveValue("air-quality");
  });

  it("says so when the table in the URL is not one Builder listed", async () => {
    renderQuality("/quality?dataset=missing-table");
    expect(await screen.findByRole("alert")).toHaveTextContent("missing-table");
  });
});

describe("Quality Center: failures are shown, never swallowed into 'no issues' (#254 §6)", () => {
  afterEach(() => vi.restoreAllMocks());

  it("counts a table whose quality could not be read as such, not as clean", async () => {
    vi.stubEnv("VITE_USE_REAL_BUILDER", "true");
    vi.spyOn(builderApi, "listQualityIssues").mockResolvedValue({
      issues: [],
      total: 0,
      next_cursor: null,
      coverage: { tables: 2, evaluated: 1, not_evaluated: 0, partial: 0, unreadable: 1 },
    });
    renderQuality();

    expect(await screen.findByTestId("quality-coverage")).toHaveTextContent("평가됨 1 · 일부만 평가 0 · 평가 안 됨(N/A) 0 · 읽지 못함 1");
    expect(screen.getByRole("alert")).toHaveTextContent("품질 결과를 읽지 못한 테이블 1개 — 문제가 없다는 뜻이 아닙니다.");
  });

  it("surfaces a load failure distinctly from an empty list", async () => {
    vi.stubEnv("VITE_USE_REAL_BUILDER", "true");
    vi.spyOn(builderApi, "listQualityIssues").mockRejectedValue(new ApiError(500, "서버 내부 오류가 발생했습니다."));
    renderQuality();

    expect(await screen.findByText("품질 문제를 불러오지 못했습니다")).toBeInTheDocument();
    expect(screen.queryByText("테이블이 없습니다")).not.toBeInTheDocument();
  });

  it("falls back to per-table reads on a Builder without GET /quality/issues (404)", async () => {
    vi.stubEnv("VITE_USE_REAL_BUILDER", "true");
    vi.spyOn(builderApi, "listQualityIssues").mockRejectedValue(new ApiError(404, "Not Found"));
    vi.spyOn(builderApi, "listDatasets").mockResolvedValue({ ...MOCK_DATASETS, total: 250 });
    const perTable = vi
      .spyOn(builderApi, "getBuildQuality")
      .mockImplementation(async (runId: string) => {
        if (runId === "transport-2026-08-12") throw new ApiError(403, "forbidden");
        return MOCK_QUALITY[runId];
      });
    renderQuality();

    const table = await screen.findByRole("table", { name: CAPTION });
    expect(within(table).getByRole("row", { name: /required_column/ })).toBeInTheDocument();
    expect(perTable).toHaveBeenCalledTimes(3);
    const coverage = screen.getByTestId("quality-coverage");
    expect(coverage).toHaveTextContent("테이블 3개 — 평가됨 0 · 일부만 평가 1 · 평가 안 됨(N/A) 1 · 읽지 못함 1.");
    expect(coverage).toHaveTextContent("전체 250개 테이블 중 처음 3개만 봅니다");
  });
});

describe("Quality Center reads every table's issues in one call (kpubdata-builder#843)", () => {
  afterEach(() => vi.restoreAllMocks());

  function issue(datasetId: string, rule: string, status: "fail" | "warn") {
    return {
      dataset_id: datasetId,
      title: datasetId === "t-1" ? "Table one" : null,
      run_id: `${datasetId}-run`,
      finished_at: null,
      source_key: "src__a",
      kind: "check" as const,
      status,
      category: "missing",
      check: {
        source_key: "src__a",
        category: "missing",
        rule,
        column: "c",
        status,
        actual: 0.2,
        threshold: 0.1,
        affected_rows: 2,
        evaluated_rows: 10,
        detail: null,
      },
      drift: null,
    };
  }

  it("calls GET /quality/issues, follows its cursor, and never asks per table", async () => {
    vi.stubEnv("VITE_USE_REAL_BUILDER", "true");
    const coverage = { tables: 150, evaluated: 150, not_evaluated: 0, partial: 0, unreadable: 0 };
    const issues = vi
      .spyOn(builderApi, "listQualityIssues")
      .mockResolvedValueOnce({ issues: [issue("t-1", "rule_a", "fail")], total: 2, next_cursor: "c1", coverage })
      .mockResolvedValueOnce({ issues: [issue("t-150", "rule_b", "warn")], total: 2, next_cursor: null, coverage });
    const perTable = vi.spyOn(builderApi, "getBuildQuality");
    const tableList = vi.spyOn(builderApi, "listDatasets");
    renderQuality();

    const table = await screen.findByRole("table", { name: CAPTION });
    expect(within(table).getAllByRole("row")).toHaveLength(3);
    // A table past the old first-100 cut is still there, named by its id when untitled.
    expect(within(table).getByRole("link", { name: "t-150" })).toBeInTheDocument();
    expect(issues).toHaveBeenCalledTimes(2);
    expect(issues.mock.calls[1][0]).toMatchObject({ cursor: "c1" });
    expect(perTable).not.toHaveBeenCalled();
    expect(tableList).not.toHaveBeenCalled();
    expect(screen.getByTestId("quality-coverage")).toHaveTextContent("테이블 150개");
  });
});
