import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QualityPage } from "@/pages/QualityPage";

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

describe("Quality Center P0 (#254)", () => {
  it("defaults to the first dataset and its latest run", async () => {
    renderQuality();
    expect(await screen.findByLabelText("테이블 선택")).toHaveValue("air-quality");
    await waitFor(() => expect(screen.getByLabelText("Run 선택")).toHaveValue("air-2026-08-14"));
  });

  it("shows availability=partial explicitly instead of hiding it or reporting PASS", async () => {
    renderQuality();
    await waitFor(() => expect(screen.getByLabelText("Run 선택")).toHaveValue("air-2026-08-14"));
    expect(await screen.findByText("partial")).toBeInTheDocument();
  });

  it("aggregates Checks Passed across sources (not just the first source) and shows the real denominator", async () => {
    renderQuality();
    // air-2026-08-14: datago__air has 1 PASS, kma__weather has 1 FAIL => 1/2, not 1/1.
    expect(await screen.findByText("1 / 2")).toBeInTheDocument();
  });

  it("shows N/A (not 0% or PASS) when evaluated_checks is 0", async () => {
    renderQuality("/quality?dataset=population");
    await waitFor(() => expect(screen.getByLabelText("Run 선택")).toHaveValue("population-2026-08-13"));
    expect(await screen.findByText("평가 없음")).toBeInTheDocument();
    expect(await screen.findByText("unavailable")).toBeInTheDocument();
    const naValues = screen.getAllByText("N/A");
    expect(naValues.length).toBeGreaterThan(0);
  });

  it("shows a real no-rule empty state distinct from the all-pass empty state", async () => {
    renderQuality("/quality?dataset=population");
    expect(await screen.findByText("평가된 quality check가 없습니다")).toBeInTheDocument();
  });

  it("shows the all-pass empty state (distinct from no-rule) when every evaluated check passed", async () => {
    renderQuality("/quality?dataset=transport");
    await waitFor(() => expect(screen.getByLabelText("Run 선택")).toHaveValue("transport-2026-08-12"));
    expect(await screen.findByText("WARN/FAIL이 없습니다")).toBeInTheDocument();
    expect(screen.queryByText("평가된 quality check가 없습니다")).not.toBeInTheDocument();
  });

  it("lists WARN/FAIL findings with real dataset fields and keeps the source visible", async () => {
    renderQuality();
    const heading = await screen.findByText("Recent quality issues");
    const card = heading.closest("div")!.parentElement!;
    expect(within(card).getByText("kma__weather")).toBeInTheDocument();
    expect(within(card).getByText("schema · required_column")).toBeInTheDocument();
  });

  it("does not silently fall back to latest run for an invalid run in the URL", async () => {
    renderQuality("/quality?dataset=air-quality&run=missing-run");
    expect(await screen.findByRole("alert")).toHaveTextContent("선택한 run을 찾을 수 없습니다");
    expect(screen.getByTestId("location")).toHaveTextContent("run=missing-run");
  });

  it("does not silently fall back for an invalid source in the URL", async () => {
    renderQuality("/quality?dataset=air-quality&source=missing-source");
    expect(await screen.findByRole("alert")).toHaveTextContent("존재하지 않습니다");
  });

  it("blocks result rendering for an invalid source and offers a reset", async () => {
    renderQuality("/quality?dataset=air-quality&source=missing-source");
    expect(await screen.findByText("잘못된 source 필터입니다")).toBeInTheDocument();
    expect(screen.queryByText("Checks Passed")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "전체 소스로 초기화" }));
    await waitFor(() => expect(screen.getByTestId("location")).not.toHaveTextContent("source="));
    expect(await screen.findByText("Checks Passed")).toBeInTheDocument();
  });

  it("hides the Dataset Detail link for the all-sources context and shows it once a source is selected", async () => {
    renderQuality("/quality?dataset=air-quality");
    await waitFor(() => expect(screen.getByLabelText("Run 선택")).toHaveValue("air-2026-08-14"));
    expect(screen.queryByRole("link", { name: "Table Detail에서 보기" })).not.toBeInTheDocument();

    // Source select는 stagesState가 "loaded"될 때까지 disabled 상태다 — 이 대기 없이 바로
    // fireEvent.change를 보내면(느린 러너에서는 stagesState 로딩이 아직 끝나지 않아) change가
    // 씹혀 selectedSource가 절대 바뀌지 않고 아래 findByRole만 타임아웃하는 flaky 실패로 이어진다.
    const sourceSelect = screen.getByLabelText("Source 선택");
    await waitFor(() => expect(sourceSelect).toBeEnabled());

    fireEvent.change(sourceSelect, { target: { value: "kma__weather" } });
    const link = await screen.findByRole("link", { name: "Table Detail에서 보기" });
    expect(link).toHaveAttribute("href", expect.stringContaining("source=kma__weather"));
  });

  it("keeps dataset/run/source context in the URL when the user changes filters", async () => {
    renderQuality();
    const sourceSelect = await screen.findByLabelText("Source 선택");
    await waitFor(() => expect(sourceSelect).toBeEnabled());
    fireEvent.change(sourceSelect, { target: { value: "kma__weather" } });
    await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent("source=kma__weather"));

    const runSelect = screen.getByLabelText("Run 선택");
    fireEvent.change(runSelect, { target: { value: "air-2026-08-13" } });
    await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent("run=air-2026-08-13"));
  });

  it("scopes Checks Passed to the selected source only, with its own denominator", async () => {
    renderQuality();
    const sourceSelect = await screen.findByLabelText("Source 선택");
    await waitFor(() => expect(sourceSelect).toBeEnabled());
    fireEvent.change(sourceSelect, { target: { value: "kma__weather" } });
    // kma__weather alone: 0 pass / 1 evaluated (fail).
    await waitFor(() => expect(screen.getByText("0 / 1")).toBeInTheDocument());
  });

  it("links Recent Quality Issues rows to the global Ask KPubData drawer without running real diagnosis", async () => {
    const { useUIStore } = await import("@/shared/hooks/useUIStore");
    act(() => useUIStore.setState({ isAssistantDrawerOpen: false }));
    renderQuality();
    const buttons = await screen.findAllByRole("button", { name: "이 문제 설명 보기" });
    expect(buttons.length).toBeGreaterThan(0);
    act(() => fireEvent.click(buttons[0]));
    expect(useUIStore.getState().isAssistantDrawerOpen).toBe(true);
  });

  it("shows an empty dataset picker distinctly from a loading or errored dataset list", async () => {
    vi.doMock("@/features/datasets/api", async () => {
      const actual = await vi.importActual<typeof import("@/features/datasets/api")>("@/features/datasets/api");
      return { ...actual, listDatasets: vi.fn().mockResolvedValue([]) };
    });
    vi.resetModules();
    const { QualityPage: FreshQualityPage } = await import("@/pages/QualityPage");
    render(<MemoryRouter initialEntries={["/quality"]}><FreshQualityPage /></MemoryRouter>);
    expect(await screen.findByText("테이블이 없습니다")).toBeInTheDocument();
    vi.doUnmock("@/features/datasets/api");
    vi.resetModules();
  });
});

describe("Quality Center: current-run success survives a Trend/history failure (#254 §6)", () => {
  afterEach(() => {
    vi.doUnmock("@/features/datasets/api");
    vi.resetModules();
  });

  it("keeps the current-run KPIs visible even if getDatasetQualityHistory fails", async () => {
    vi.doMock("@/features/datasets/api", async () => {
      const actual = await vi.importActual<typeof import("@/features/datasets/api")>("@/features/datasets/api");
      return {
        ...actual,
        getDatasetQualityHistory: vi.fn().mockRejectedValue(new Error("history unavailable")),
      };
    });
    vi.resetModules();
    const { QualityPage: FreshQualityPage } = await import("@/pages/QualityPage");
    render(<MemoryRouter initialEntries={["/quality"]}><FreshQualityPage /></MemoryRouter>);

    // Trend card surfaces its own failure...
    expect(await screen.findByText(/이력을 불러오지 못했습니다/)).toBeInTheDocument();
    // ...while the current-run Checks Passed KPI (independent fetch) still renders real data.
    expect(await screen.findByText("1 / 2")).toBeInTheDocument();
  });
});

describe("Quality Center: review follow-ups (#254 issue review comment)", () => {
  it("shows the full Dataset/Run/Source/Stage context next to Rule pass rate, not just the source", async () => {
    renderQuality();
    await waitFor(() => expect(screen.getByLabelText("Run 선택")).toHaveValue("air-2026-08-14"));
    const heading = await screen.findByText("Rule pass rate");
    const card = heading.parentElement!;
    expect(within(card).getByText(/Table: 대기질 통합 데이터/)).toBeInTheDocument();
    expect(within(card).getByText(/Run: air-2026-08-14/)).toBeInTheDocument();
    expect(within(card).getByText(/Source: 전체 소스/)).toBeInTheDocument();
  });

  it("breaks quality results down per source instead of only reporting the first source's numbers", async () => {
    renderQuality();
    const heading = await screen.findByText("Source별 검사 현황");
    const card = heading.parentElement!;
    expect(within(card).getByText("datago__air")).toBeInTheDocument();
    expect(within(card).getByText(/1 \/ 1 PASS/)).toBeInTheDocument();
    expect(within(card).getByText("kma__weather")).toBeInTheDocument();
    expect(within(card).getByText(/FAIL 1/)).toBeInTheDocument();
  });

  it("shows validated_rows (검사 행 수) per run in the Trend table", async () => {
    renderQuality();
    const rows = await screen.findAllByText("1,200행");
    expect(rows.length).toBeGreaterThan(0);
  });

  it("formats a ratio-named rule's actual/threshold as a percentage, not a bare 0.08", async () => {
    renderQuality("/quality?dataset=air-quality&run=air-2026-08-13");
    await waitFor(() => expect(screen.getByLabelText("Run 선택")).toHaveValue("air-2026-08-13"));
    expect(await screen.findByText("8.0%")).toBeInTheDocument();
    expect(screen.getByText("5.0%")).toBeInTheDocument();
    expect(screen.queryByText("0.08")).not.toBeInTheDocument();
  });

  it("shows affected/evaluated row counts with an explicit 행 unit instead of bare numbers", async () => {
    renderQuality("/quality?dataset=air-quality&run=air-2026-08-13");
    await waitFor(() => expect(screen.getByLabelText("Run 선택")).toHaveValue("air-2026-08-13"));
    expect(await screen.findByText(/16행 \/ 200행/)).toBeInTheDocument();
  });

  it("lets a Recent Quality Issues row navigate straight to the Build that produced it", async () => {
    renderQuality();
    const heading = await screen.findByText("Recent quality issues");
    const card = heading.closest("div")!.parentElement!;
    const link = within(card).getByRole("link", { name: "Run 보기" });
    expect(link).toHaveAttribute("href", "/refresh-jobs/air-2026-08-14");
  });
});

describe("Quality Center: API/permission errors are shown, never silently swallowed into 'no issues' (#254 §6)", () => {
  afterEach(() => {
    vi.doUnmock("@/features/datasets/api");
    vi.resetModules();
  });

  it("surfaces a current-run quality fetch failure as an explicit error, not an empty/PASS state", async () => {
    vi.doMock("@/features/datasets/api", async () => {
      const actual = await vi.importActual<typeof import("@/features/datasets/api")>("@/features/datasets/api");
      const { ApiError } = await import("@/shared/lib/builderApi");
      return {
        ...actual,
        getBuildQuality: vi.fn().mockRejectedValue(new ApiError(403, "접근 권한이 없습니다. 관리자에게 권한을 요청하세요. (재로그인으로 해결되지 않습니다)")),
      };
    });
    vi.resetModules();
    const { QualityPage: FreshQualityPage } = await import("@/pages/QualityPage");
    render(<MemoryRouter initialEntries={["/quality"]}><FreshQualityPage /></MemoryRouter>);

    expect(await screen.findByText("Quality 결과를 불러오지 못했습니다")).toBeInTheDocument();
    expect(screen.getByText(/접근 권한이 없습니다/)).toBeInTheDocument();
    // A 403 must not be presented as "no issues found" / an implicit PASS.
    expect(screen.queryByText("WARN/FAIL이 없습니다")).not.toBeInTheDocument();
    expect(screen.queryByText("1 / 2")).not.toBeInTheDocument();
  });

  it("surfaces a dataset list fetch failure distinctly from an empty dataset list", async () => {
    vi.doMock("@/features/datasets/api", async () => {
      const actual = await vi.importActual<typeof import("@/features/datasets/api")>("@/features/datasets/api");
      const { ApiError } = await import("@/shared/lib/builderApi");
      return { ...actual, listDatasets: vi.fn().mockRejectedValue(new ApiError(500, "서버 내부 오류가 발생했습니다.")) };
    });
    vi.resetModules();
    const { QualityPage: FreshQualityPage } = await import("@/pages/QualityPage");
    render(<MemoryRouter initialEntries={["/quality"]}><FreshQualityPage /></MemoryRouter>);

    expect(await screen.findByText("테이블 목록을 불러오지 못했습니다")).toBeInTheDocument();
    expect(screen.queryByText("테이블이 없습니다")).not.toBeInTheDocument();
  });
});
