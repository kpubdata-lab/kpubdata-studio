/**
 * Quality Center: actionable quality issues across tables in one table (#536).
 *
 * Mock fixture: air-quality's latest run has a FAIL and a schema drift finding and is
 * partial, population's latest run evaluated nothing, transport's latest run all passed.
 */
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QualityPage } from "@/pages/QualityPage";

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
    expect(coverage).toHaveTextContent("테이블 3개 — 조치 필요 1 · 통과 1 · 평가 안 됨(N/A) 1 · 읽지 못함 0");
    const notEvaluated = screen.getByText(/평가 결과가 없는 최근 갱신/);
    expect(within(notEvaluated).getByRole("link", { name: "행정구역별 인구" })).toHaveAttribute("href", "/tables/population?tab=quality");
    expect(screen.getByText(/일부 결과만 있는 갱신/)).toHaveTextContent("대기질 통합 데이터");
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

    fireEvent.change(screen.getByLabelText("테이블"), { target: { value: "transport" } });
    await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent("dataset=transport"));
    expect(screen.getByText("필터에 맞는 품질 문제가 없습니다.")).toBeInTheDocument();
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
  afterEach(() => {
    vi.doUnmock("@/features/datasets/api");
    vi.resetModules();
  });

  it("counts a table whose quality could not be read as such, not as clean", async () => {
    vi.doMock("@/features/datasets/api", async () => {
      const actual = await vi.importActual<typeof import("@/features/datasets/api")>("@/features/datasets/api");
      const { ApiError } = await import("@/shared/lib/builderApi");
      return {
        ...actual,
        getBuildQuality: vi.fn((runId: string, signal?: AbortSignal) =>
          runId === "transport-2026-08-12" ? Promise.reject(new ApiError(403, "forbidden")) : actual.getBuildQuality(runId, signal),
        ),
      };
    });
    vi.resetModules();
    const { QualityPage: FreshQualityPage } = await import("@/pages/QualityPage");
    render(<MemoryRouter initialEntries={["/quality"]}><FreshQualityPage /></MemoryRouter>);

    expect(await screen.findByTestId("quality-coverage")).toHaveTextContent("통과 0 · 평가 안 됨(N/A) 1 · 읽지 못함 1");
    expect(screen.getByRole("alert")).toHaveTextContent("품질 결과를 읽지 못한 테이블: 대중교통 운행 현황");
  });

  it("surfaces a table list failure distinctly from an empty list", async () => {
    vi.doMock("@/features/datasets/api", async () => {
      const actual = await vi.importActual<typeof import("@/features/datasets/api")>("@/features/datasets/api");
      const { ApiError } = await import("@/shared/lib/builderApi");
      return { ...actual, listDatasetsPage: vi.fn().mockRejectedValue(new ApiError(500, "서버 내부 오류가 발생했습니다.")) };
    });
    vi.resetModules();
    const { QualityPage: FreshQualityPage } = await import("@/pages/QualityPage");
    render(<MemoryRouter initialEntries={["/quality"]}><FreshQualityPage /></MemoryRouter>);

    expect(await screen.findByText("테이블 목록을 불러오지 못했습니다")).toBeInTheDocument();
    expect(screen.queryByText("테이블이 없습니다")).not.toBeInTheDocument();
  });
});
