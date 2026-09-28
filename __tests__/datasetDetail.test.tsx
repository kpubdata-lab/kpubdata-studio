import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DatasetDetailPage } from "@/pages/DatasetDetailPage";
import { useUIStore } from "@/shared/hooks/useUIStore";

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location">{location.pathname}{location.search}</output>;
}

function renderDetail(initialEntry = "/datasets/air-quality") {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <LocationProbe />
      <Routes><Route path="/datasets/:datasetId" element={<DatasetDetailPage />} /></Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.stubEnv("VITE_USE_REAL_BUILDER", "false");
  act(() => useUIStore.setState({ isKubiDrawerOpen: false }));
});
afterEach(() => vi.unstubAllEnvs());

describe("Dataset Detail P0 (#253)", () => {
  it("defaults to latest run and the highest completed stage", async () => {
    renderDetail();
    expect(await screen.findByLabelText("Run 선택")).toHaveValue("air-2026-08-14");
    await waitFor(() => expect(screen.getByRole("button", { name: /gold completed/ })).toHaveAttribute("aria-pressed", "true"));
    expect(screen.getByRole("link", { name: "이 Run 게시" })).toHaveAttribute(
      "href",
      "/builds/air-2026-08-14/publish?dataset=air-quality",
    );
  });

  it("selects an accessible historical run from the URL", async () => {
    renderDetail("/datasets/air-quality?run=air-2026-08-13");
    expect(await screen.findByLabelText("Run 선택")).toHaveValue("air-2026-08-13");
    expect(screen.getByTestId("location")).toHaveTextContent("run=air-2026-08-13");
    expect(screen.getByRole("link", { name: "이 Run 게시" })).toHaveAttribute(
      "href",
      "/builds/air-2026-08-13/publish?dataset=air-quality",
    );
  });

  it("does not silently replace an invalid run with latest", async () => {
    renderDetail("/datasets/air-quality?run=missing-run");
    expect(await screen.findByRole("alert")).toHaveTextContent("선택한 run에 접근할 수 없습니다");
    expect(screen.getByTestId("location")).toHaveTextContent("run=missing-run");
    expect(screen.queryByLabelText("Run 선택")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "이 Run 게시" })).not.toBeInTheDocument();
  });

  it("keeps an invalid source visible in the select with a recovery path", async () => {
    renderDetail("/datasets/air-quality?source=ghost__source");
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("ghost__source");
    const sourceSelect = screen.getByLabelText("Source 선택");
    expect(sourceSelect).toHaveValue("ghost__source");
    expect(within(sourceSelect).getByRole("option", { selected: true })).toHaveTextContent(
      "존재하지 않는 source",
    );
    fireEvent.change(sourceSelect, { target: { value: "datago__air" } });
    await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent("source=datago__air"));
  });

  it("removes an invalid stage param from the URL to match the fallback UI", async () => {
    renderDetail("/datasets/air-quality?stage=platinum");
    await screen.findByLabelText("Run 선택");
    await waitFor(() => expect(screen.getByTestId("location")).not.toHaveTextContent("stage=platinum"));
    expect(screen.getByLabelText("Stage 선택")).toHaveValue("gold");
  });

  it("synchronizes source selection and chooses bronze when no higher stage completed", async () => {
    renderDetail();
    const sourceSelect = await screen.findByLabelText("Source 선택");
    await waitFor(() => expect(sourceSelect).toBeEnabled());
    fireEvent.change(sourceSelect, { target: { value: "kma__weather" } });
    await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent("source=kma__weather"));
    expect(screen.getByRole("button", { name: /bronze completed/ })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: /silver failed/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /gold not_run/ })).toBeInTheDocument();
  });

  it("updates the stage URL from lineage and applies it to Schema context", async () => {
    renderDetail("/datasets/air-quality?stage=silver&tab=schema");
    expect(await screen.findByText("observed_at")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Stage 선택"), { target: { value: "bronze" } });
    await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent("stage=bronze"));
    expect(await screen.findByText("Schema 없음/지원되지 않음")).toBeInTheDocument();
  });

  it("shows only the persisted Silver sample and no fake Gold preview", async () => {
    renderDetail("/datasets/air-quality?stage=silver&tab=preview");
    expect(await screen.findByText("2026-08-14T00:00:00Z")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Stage 선택"), { target: { value: "gold" } });
    expect(await screen.findByText("미리보기 없음/지원되지 않음")).toBeInTheDocument();
  });

  it("renders all six tabs", async () => {
    renderDetail();
    const tablist = await screen.findByRole("tablist", { name: "Dataset detail tabs" });
    for (const label of ["Overview", "Schema", "Preview", "Quality", "Builds", "AI"]) {
      expect(within(tablist).getByRole("tab", { name: label })).toBeInTheDocument();
    }
  });

  it("shows unavailable lineage nodes without presenting them as completed", async () => {
    renderDetail("/datasets/population");
    const gold = await screen.findByRole("button", { name: "gold unavailable" });
    expect(gold).toHaveAttribute("aria-pressed", "false");
    expect(within(gold).getByText("unavailable")).toBeInTheDocument();
  });

  it.each([
    ["/datasets/air-quality?source=datago__air&tab=quality", "PASS"],
    ["/datasets/air-quality?source=kma__weather&tab=quality", "FAIL"],
    ["/datasets/population?source=kosis__population&tab=quality", "N/A"],
  ])("shows actual scoped quality without inventing a score: %s", async (path, expected) => {
    renderDetail(path);
    const panel = await screen.findByRole("tabpanel", { name: "Quality" });
    expect((await within(panel).findAllByText(expected)).length).toBeGreaterThan(0);
    expect(within(panel).queryByText(/score/i)).not.toBeInTheDocument();
  });

  it("explains a run-level failed status next to a completed/PASS selected stage instead of hiding the contradiction (audit #2)", async () => {
    renderDetail();
    // 기본 선택(latest run air-2026-08-14, source datago__air)은 gold stage가 completed/PASS이면서
    // run 전체 상태는 kma__weather의 silver 실패로 인해 failed다 — 두 상태 semantics는 서로 다른
    // scope(run 전체 vs 선택된 source/stage)이므로 값 자체를 숨기거나 조작하지 않는다.
    await waitFor(() => expect(screen.getByRole("button", { name: /gold completed/ })).toHaveAttribute("aria-pressed", "true"));

    const runStatusRow = screen.getByTitle("선택된 source/stage가 아니라 이 run 전체(모든 source)의 결과입니다");
    expect(runStatusRow).toHaveTextContent("Run 상태");
    expect(runStatusRow).toHaveTextContent("failed");

    const stageBadge = screen.getByTitle("선택된 source(datago__air)의 gold stage 상태");
    expect(stageBadge).toHaveTextContent("gold");
    expect(stageBadge).toHaveTextContent("completed");

    const explanation = await screen.findByRole("alert");
    expect(explanation).toHaveTextContent(/run 상태는 failed이지만/i);
    expect(explanation).toHaveTextContent("kma__weather");
  });

  it("shows run history and links each run to build detail", async () => {
    renderDetail("/datasets/air-quality?tab=builds");
    const panel = await screen.findByRole("tabpanel", { name: "Builds" });
    expect(within(panel).getByText(/air-2026-08-13/)).toBeInTheDocument();
    expect(within(panel).getAllByRole("link", { name: "보기" })[0]).toHaveAttribute("href", "/builds/air-2026-08-14");
  });

  it("propagates the known latest-run context to Ask KPubData when opening the AI tab, not '—' (audit #5)", async () => {
    // 기본 진입(초기 URL에 ?run= 없음, latest run 암묵 선택)에서 AI 탭을 클릭한다 — stage와 달리
    // run은 URL에 명시적으로 반영되지 않아 Ask KPubData RUN context가 "—"로 보이던 문제를 재현한다.
    renderDetail();
    await screen.findByLabelText("Run 선택");
    fireEvent.click(screen.getByRole("tab", { name: "AI" }));

    await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent("run=air-2026-08-14"));
    const panel = await screen.findByRole("tabpanel", { name: "AI" });
    expect(within(panel).getByText("air-2026-08-14")).toBeInTheDocument();
  });

  it("back-fills the canonical run/source/stage context on direct entry to ?tab=ai, matching the tab-click path (A1)", async () => {
    // goToTab("ai")를 거치지 않는 직접 진입/새로고침에서도 화면이 확정한 latest run과
    // canonical source·stage가 Ask KPubData URL context에 반영돼야 한다(#319 후속).
    renderDetail("/datasets/air-quality?tab=ai");

    await waitFor(() => {
      const location = screen.getByTestId("location").textContent ?? "";
      expect(location).toContain("run=air-2026-08-14");
      expect(location).toContain("source=datago__air");
      expect(location).toContain("stage=gold");
    });

    // 수렴 후에는 더 이상 URL을 갱신하지 않는다(update loop 없음).
    const settled = screen.getByTestId("location").textContent;
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(screen.getByTestId("location").textContent).toBe(settled);

    const panel = await screen.findByRole("tabpanel", { name: "AI" });
    expect(within(panel).getByText("air-2026-08-14")).toBeInTheDocument();
  });

  it("does not overwrite an explicit valid run/source/stage on direct entry to ?tab=ai (A1)", async () => {
    renderDetail("/datasets/air-quality?tab=ai&run=air-2026-08-13&source=datago__air&stage=silver");

    await screen.findByRole("tabpanel", { name: "AI" });
    await new Promise((resolve) => setTimeout(resolve, 50));
    const location = screen.getByTestId("location").textContent ?? "";
    expect(location).toContain("run=air-2026-08-13");
    expect(location).toContain("source=datago__air");
    expect(location).toContain("stage=silver");
  });

  it("renders Ask KPubData inline on the AI tab with this dataset's context, not a drawer launcher (#256 review)", async () => {
    renderDetail("/datasets/air-quality?tab=ai");
    const panel = await screen.findByRole("tabpanel", { name: "AI" });
    // 프로토타입처럼 AI 탭 자체가 Ask KPubData 전체 화면(context bar/질문/답변)이어야 한다 — drawer를 대신 여는 launcher card가 아니다.
    expect(within(panel).getByText("air-quality")).toBeInTheDocument();
    expect(within(panel).getByText(/BYOK/)).toBeInTheDocument();
    expect(useUIStore.getState().isKubiDrawerOpen).toBe(false);
  });

  it("AI tab demo (no API key, mock mode): Generated SQL and Result Preview render deterministically, clearly labeled as demo (#256 review)", async () => {
    // air-2026-08-14는 multi-source run이라 어느 소스인지 URL에 있어야 stage evidence가
    // fail-closed로 빠지지 않는다(#319 후속) — Dataset Detail의 goToTab("ai")가 실제로 하는 동기화.
    renderDetail("/datasets/air-quality?tab=ai&source=datago__air&stage=silver");
    const panel = await screen.findByRole("tabpanel", { name: "AI" });
    // A1: 직접 진입 시에도 latest run이 URL context에 back-fill될 때까지 기다린 뒤 상호작용한다
    // (goToTab("ai")가 클릭 경로에서 동기적으로 하던 동기화와 동일한 최종 상태).
    await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent("run=air-2026-08-14"));

    fireEvent.click(within(panel).getByRole("button", { name: "데모 질문 보내보기" }));

    expect(await within(panel).findByText(/DEMO/)).toBeInTheDocument();
    expect(within(panel).getByText(/SELECT region, COUNT\(\*\)/)).toBeInTheDocument();

    fireEvent.click(within(panel).getByRole("button", { name: "실행" }));

    expect(await within(panel).findByText("서울")).toBeInTheDocument();
    expect(within(panel).getByText("123")).toBeInTheDocument();
  });
});

async function findPassport() {
  const heading = await screen.findByRole("heading", { name: "Data Passport" });
  return heading.closest("[class*='rounded-xl']") as HTMLElement;
}

describe("Data Passport (#Phase2 UI polish)", () => {
  it("shows Provider/Source, dataset identity, run status, selected source·stage status, quality, schema, spec digest and artifact from the fetched fixture", async () => {
    renderDetail();
    await waitFor(() => expect(screen.getByRole("button", { name: /gold completed/ })).toHaveAttribute("aria-pressed", "true"));

    const passport = await findPassport();
    expect(within(passport).getByText("data.go.kr.air, kma.weather")).toBeInTheDocument();
    expect(within(passport).getByText("대기질 통합 데이터")).toBeInTheDocument();
    expect(within(passport).getByText("air-quality")).toBeInTheDocument();
    expect(within(passport).getByText("sha256:air14")).toBeInTheDocument();
    // Schema/Artifact는 selected stage detail의 별도 비동기 조회(getBuildStageDetail) 결과라 좀 더 늦게 반영된다.
    expect(await within(passport).findByText("2 columns")).toBeInTheDocument();
    expect(await within(passport).findByText("parquet")).toBeInTheDocument();
    expect(within(passport).getByText("PASS")).toBeInTheDocument();
  });

  it("labels run-level status and selected source/stage status separately, without collapsing them into one generic status (audit #2)", async () => {
    renderDetail();
    await waitFor(() => expect(screen.getByRole("button", { name: /gold completed/ })).toHaveAttribute("aria-pressed", "true"));

    const passport = await findPassport();
    const runRow = within(passport).getByText("Run 상태(전체)").closest("div")!;
    expect(runRow).toHaveTextContent("failed");

    const stageRow = within(passport).getByText("선택된 Source·Stage 상태").closest("div")!;
    expect(within(stageRow).getByText("completed")).toBeInTheDocument();
    // 같은 값으로 뭉개지지 않는다 — run은 failed, 선택된 stage는 completed.
    expect(within(stageRow).queryByText("failed")).not.toBeInTheDocument();
  });

  it("labels the spec value as a digest/fingerprint, not a version string", async () => {
    renderDetail();
    const passport = await findPassport();
    expect(await within(passport).findByText("sha256:air14")).toBeInTheDocument();
    expect(within(passport).getByText("BuildSpec digest")).toBeInTheDocument();
    expect(within(passport).queryByText(/^v\d/)).not.toBeInTheDocument();
  });

  it("does not crash and uses the defined fallback ('확인 불가') for a run with no spec digest, instead of inventing one", async () => {
    renderDetail("/datasets/population");
    await screen.findByLabelText("Run 선택");
    const passport = await findPassport();
    const digestRow = within(passport).getByText("BuildSpec digest").closest("div")!;
    expect(within(digestRow).getByText("확인 불가")).toBeInTheDocument();
  });

  it("shows the defined '제공되지 않음' fallback for schema when the selected stage carries no schema (bronze), without crashing", async () => {
    renderDetail("/datasets/air-quality?stage=bronze");
    await screen.findByLabelText("Run 선택");
    const passport = await findPassport();
    const schemaRow = within(passport).getByText("Schema").closest("div")!;
    expect(await within(schemaRow).findByText("제공되지 않음")).toBeInTheDocument();
  });

  it("does not present fields absent from the schema, like license/freshness/verified score", async () => {
    renderDetail();
    const passport = await findPassport();
    expect(within(passport).queryByText(/license/i)).not.toBeInTheDocument();
    expect(within(passport).queryByText(/freshness/i)).not.toBeInTheDocument();
    expect(within(passport).queryByText(/verified/i)).not.toBeInTheDocument();
    expect(within(passport).queryByText(/인증/)).not.toBeInTheDocument();
  });

  it("navigates to the AI tab from the Passport's Ask KPubData entry point", async () => {
    renderDetail();
    const passport = await findPassport();
    fireEvent.click(within(passport).getByRole("button", { name: /Ask KPubData 가 이 dataset의 BuildSpec 수정안을 제안할 수 있습니다/ }));

    const panel = await screen.findByRole("tabpanel", { name: "AI" });
    expect(within(panel).getByText("air-quality")).toBeInTheDocument();
  });
});
