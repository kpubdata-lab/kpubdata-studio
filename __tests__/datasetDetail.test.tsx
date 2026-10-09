import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AssistantDrawer } from "@/features/assistant/AssistantDrawer";
import { DatasetDetailPage } from "@/pages/DatasetDetailPage";
import { useUIStore } from "@/shared/hooks/useUIStore";
import { hideDemoWarehouse } from "./support/noWarehouse";

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location">{location.pathname}{location.search}</output>;
}

function renderDetail(initialEntry = "/tables/air-quality") {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <LocationProbe />
      <Routes><Route path="/tables/:datasetId" element={<DatasetDetailPage />} /></Routes>
      <AssistantDrawer />
    </MemoryRouter>,
  );
}

/** Ask KPubData opens as the global drawer (Layout mounts it once; mounted here beside the page). */
function findAssistant() {
  return screen.findByRole("dialog", { name: "Ask KPubData" });
}

beforeEach(() => {
  vi.stubEnv("VITE_USE_REAL_BUILDER", "false");
  // The run-based Table Detail: a deployment without a warehouse (#530).
  hideDemoWarehouse();
  act(() => useUIStore.setState({ isAssistantDrawerOpen: false }));
});
afterEach(() => vi.unstubAllEnvs());

describe("Dataset Detail P0 (#253)", () => {
  it("defaults to latest run and the highest completed stage", async () => {
    renderDetail();
    expect(await screen.findByLabelText("실행 선택")).toHaveValue("air-2026-08-14");
    await waitFor(() => expect(screen.getByRole("button", { name: /gold 완료/ })).toHaveAttribute("aria-pressed", "true"));
    expect(screen.getByRole("link", { name: "이 실행 게시" })).toHaveAttribute(
      "href",
      "/refresh-jobs/air-2026-08-14/publish?dataset=air-quality",
    );
  });

  it("selects an accessible historical run from the URL", async () => {
    renderDetail("/tables/air-quality?run=air-2026-08-13");
    expect(await screen.findByLabelText("실행 선택")).toHaveValue("air-2026-08-13");
    expect(screen.getByTestId("location")).toHaveTextContent("run=air-2026-08-13");
    expect(screen.getByRole("link", { name: "이 실행 게시" })).toHaveAttribute(
      "href",
      "/refresh-jobs/air-2026-08-13/publish?dataset=air-quality",
    );
  });

  it("does not silently replace an invalid run with latest", async () => {
    renderDetail("/tables/air-quality?run=missing-run");
    expect(await screen.findByRole("alert")).toHaveTextContent("선택한 실행을 찾을 수 없습니다");
    expect(screen.getByTestId("location")).toHaveTextContent("run=missing-run");
    expect(screen.queryByLabelText("실행 선택")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "이 실행 게시" })).not.toBeInTheDocument();
  });

  it("keeps an invalid source visible in the select with a recovery path", async () => {
    renderDetail("/tables/air-quality?source=ghost__source");
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("ghost__source");
    const sourceSelect = screen.getByLabelText("소스 선택");
    expect(sourceSelect).toHaveValue("ghost__source");
    expect(within(sourceSelect).getByRole("option", { selected: true })).toHaveTextContent(
      "존재하지 않는 소스",
    );
    fireEvent.change(sourceSelect, { target: { value: "datago__air" } });
    await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent("source=datago__air"));
  });

  it("removes an invalid stage param from the URL to match the fallback UI", async () => {
    renderDetail("/tables/air-quality?stage=platinum");
    await screen.findByLabelText("실행 선택");
    await waitFor(() => expect(screen.getByTestId("location")).not.toHaveTextContent("stage=platinum"));
    // The URL is cleaned at once, but the fallback stage is `bronze` until the stage
    // summary loads and becomes the highest completed stage after it (#459).
    await waitFor(() => expect(screen.getByLabelText("단계 선택")).toHaveValue("gold"));
  });

  it("synchronizes source selection and chooses bronze when no higher stage completed", async () => {
    renderDetail();
    const sourceSelect = await screen.findByLabelText("소스 선택");
    await waitFor(() => expect(sourceSelect).toBeEnabled());
    fireEvent.change(sourceSelect, { target: { value: "kma__weather" } });
    await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent("source=kma__weather"));
    expect(screen.getByRole("button", { name: /bronze 완료/ })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: /silver 실패/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /gold 실행 안 됨/ })).toBeInTheDocument();
  });

  it("updates the stage URL from lineage and applies it to Schema context", async () => {
    renderDetail("/tables/air-quality?stage=silver&tab=schema");
    expect(await screen.findByText("observed_at")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("단계 선택"), { target: { value: "bronze" } });
    await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent("stage=bronze"));
    expect(await screen.findByText("스키마 없음/지원되지 않음")).toBeInTheDocument();
  });

  it("shows only the persisted Silver sample and no fake Gold preview", async () => {
    renderDetail("/tables/air-quality?stage=silver&tab=preview");
    expect(await screen.findByText("2026-08-14T00:00:00Z")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("단계 선택"), { target: { value: "gold" } });
    // Gold keeps no sample: that is "not supported", not "0 rows" (#844).
    expect(await screen.findByText("이 단계는 미리보기를 지원하지 않습니다")).toBeInTheDocument();
    expect(screen.queryByText(/0행/)).toBeNull();
  });

  it("shows the table's five status axes separately (#422)", async () => {
    renderDetail();
    const axes = await screen.findByRole("list", { name: "테이블 상태" });
    expect(within(axes).getAllByRole("listitem")).toHaveLength(5);
    expect(axes).toHaveTextContent("완전성부분");
    expect(axes).toHaveTextContent("갱신실패");
  });

  it("renders five tabs, with no AI tab (#421)", async () => {
    renderDetail();
    const tablist = await screen.findByRole("tablist", { name: "테이블 상세 탭" });
    for (const label of ["개요", "스키마", "미리보기", "품질", "실행 기록"]) {
      expect(within(tablist).getByRole("tab", { name: label })).toBeInTheDocument();
    }
    expect(within(tablist).queryByRole("tab", { name: "AI" })).not.toBeInTheDocument();
  });

  it("shows unavailable lineage nodes without presenting them as completed", async () => {
    renderDetail("/tables/population");
    const gold = await screen.findByRole("button", { name: "gold 정보 없음" });
    expect(gold).toHaveAttribute("aria-pressed", "false");
    expect(within(gold).getByText("정보 없음")).toBeInTheDocument();
  });

  it.each([
    ["/tables/air-quality?source=datago__air&tab=quality", "PASS"],
    ["/tables/air-quality?source=kma__weather&tab=quality", "FAIL"],
    ["/tables/population?source=kosis__population&tab=quality", "N/A"],
  ])("shows actual scoped quality without inventing a score: %s", async (path, expected) => {
    renderDetail(path);
    const panel = await screen.findByRole("tabpanel", { name: "품질" });
    expect((await within(panel).findAllByText(expected)).length).toBeGreaterThan(0);
    expect(within(panel).queryByText(/score/i)).not.toBeInTheDocument();
  });

  it("explains a run-level failed status next to a completed/PASS selected stage instead of hiding the contradiction (audit #2)", async () => {
    renderDetail();
    // 기본 선택(latest run air-2026-08-14, source datago__air)은 gold stage가 completed/PASS이면서
    // run 전체 상태는 kma__weather의 silver 실패로 인해 failed다 — 두 상태 semantics는 서로 다른
    // scope(run 전체 vs 선택된 source/stage)이므로 값 자체를 숨기거나 조작하지 않는다.
    await waitFor(() => expect(screen.getByRole("button", { name: /gold 완료/ })).toHaveAttribute("aria-pressed", "true"));

    const runStatusRow = screen.getByTitle("선택된 소스/단계가 아니라 이 실행 전체(모든 소스)의 결과입니다");
    expect(runStatusRow).toHaveTextContent("실행 상태");
    expect(runStatusRow).toHaveTextContent("실패");

    const stageBadge = screen.getByTitle("선택된 소스(datago__air)의 gold 단계 상태");
    expect(stageBadge).toHaveTextContent("gold");
    expect(stageBadge).toHaveTextContent("완료");

    const explanation = await screen.findByRole("alert");
    expect(explanation).toHaveTextContent(/실행은 실패했지만/);
    expect(explanation).toHaveTextContent("kma__weather");
  });

  it("shows run history and links each run to build detail", async () => {
    renderDetail("/tables/air-quality?tab=builds");
    const panel = await screen.findByRole("tabpanel", { name: "실행 기록" });
    expect(within(panel).getByText(/air-2026-08-13/)).toBeInTheDocument();
    expect(within(panel).getAllByRole("link", { name: "보기" })[0]).toHaveAttribute("href", "/refresh-jobs/air-2026-08-14");
  });

  it("offers Refresh for the selected run, opening its spec in edit mode (#423)", async () => {
    renderDetail("/tables/air-quality?run=air-2026-08-13");
    expect(await screen.findByRole("link", { name: "갱신" })).toHaveAttribute("href", "/refresh-jobs/air-2026-08-13/edit");
  });

  it("'Ask about this table' carries the known latest-run context into Ask KPubData, not '—' (audit #5, #421)", async () => {
    // Default entry (no ?run= in the URL, latest run chosen implicitly). Unlike stage, the run is not
    // otherwise written to the URL, which is how the RUN context used to show as "—".
    renderDetail();
    await screen.findByLabelText("실행 선택");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "이 테이블에 대해 묻기" }));

    await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent("run=air-2026-08-14"));
    const drawer = await findAssistant();
    expect(within(drawer).getByText("air-2026-08-14")).toBeInTheDocument();
  });

  it("a saved ?tab=ai link opens Ask KPubData with the canonical run/source/stage, and drops the tab (A1, #421)", async () => {
    // The removed AI tab's links still lead somewhere: the same context the header action writes.
    renderDetail("/tables/air-quality?tab=ai");

    await waitFor(() => {
      const location = screen.getByTestId("location").textContent ?? "";
      expect(location).toContain("run=air-2026-08-14");
      expect(location).toContain("source=datago__air");
      expect(location).toContain("stage=gold");
      expect(location).not.toContain("tab=ai");
    });

    // Once converged the URL stops changing (no update loop).
    const settled = screen.getByTestId("location").textContent;
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(screen.getByTestId("location").textContent).toBe(settled);

    const drawer = await findAssistant();
    expect(within(drawer).getByText("air-2026-08-14")).toBeInTheDocument();
    expect(await screen.findByRole("tabpanel", { name: "개요" })).toBeInTheDocument();
  });

  it("a saved ?tab=ai link does not overwrite an explicit valid run/source/stage (A1)", async () => {
    renderDetail("/tables/air-quality?tab=ai&run=air-2026-08-13&source=datago__air&stage=silver");

    await findAssistant();
    // Wait for the ?tab=ai rewrite itself rather than a fixed delay, which loses the race under
    // a loaded test run (#679).
    await waitFor(() => expect(screen.getByTestId("location").textContent ?? "").not.toContain("tab=ai"));
    const location = screen.getByTestId("location").textContent ?? "";
    expect(location).toContain("run=air-2026-08-13");
    expect(location).toContain("source=datago__air");
    expect(location).toContain("stage=silver");
    expect(location).not.toContain("tab=ai");
  });

  it("Ask KPubData demo (no API key, mock mode): Generated SQL and Result Preview render deterministically, clearly labeled as demo (#256 review)", async () => {
    // air-2026-08-14 is a multi-source run, so the source has to be in the URL or stage evidence is
    // fail-closed (#319 follow-up) — which is what askAboutThis() writes before opening the drawer.
    renderDetail();
    await screen.findByLabelText("실행 선택");
    await waitFor(() => expect(screen.getByRole("button", { name: /gold 완료/ })).toHaveAttribute("aria-pressed", "true"));
    fireEvent.click(screen.getByRole("button", { name: "이 테이블에 대해 묻기" }));
    await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent("source=datago__air"));
    const panel = await findAssistant();

    fireEvent.click(within(panel).getByRole("button", { name: "데모 질문 보내보기" }));

    expect(await within(panel).findByText(/DEMO/)).toBeInTheDocument();
    expect(within(panel).getByText(/SELECT region, COUNT\(\*\)/)).toBeInTheDocument();

    fireEvent.click(within(panel).getByRole("button", { name: "실행" }));

    expect(await within(panel).findByText("서울")).toBeInTheDocument();
    expect(within(panel).getByText("123")).toBeInTheDocument();
  });
});

async function findPassport() {
  const heading = await screen.findByRole("heading", { name: "데이터 여권" });
  return heading.closest("[class*='rounded-xl']") as HTMLElement;
}

describe("Data Passport (#Phase2 UI polish)", () => {
  it("shows Provider/Source, dataset identity, run status, selected source·stage status, quality, schema, spec digest and artifact from the fetched fixture", async () => {
    renderDetail();
    await waitFor(() => expect(screen.getByRole("button", { name: /gold 완료/ })).toHaveAttribute("aria-pressed", "true"));

    const passport = await findPassport();
    expect(within(passport).getByText("datago.air, kma.weather")).toBeInTheDocument();
    expect(within(passport).getByText("대기질 통합 데이터")).toBeInTheDocument();
    expect(within(passport).getByText("air-quality")).toBeInTheDocument();
    expect(within(passport).getByText("sha256:air14")).toBeInTheDocument();
    // Schema/Artifact는 selected stage detail의 별도 비동기 조회(getBuildStageDetail) 결과라 좀 더 늦게 반영된다.
    expect(await within(passport).findByText("컬럼 2개")).toBeInTheDocument();
    expect(await within(passport).findByText("parquet")).toBeInTheDocument();
    expect(within(passport).getByText("PASS")).toBeInTheDocument();
  });

  it("labels run-level status and selected source/stage status separately, without collapsing them into one generic status (audit #2)", async () => {
    renderDetail();
    await waitFor(() => expect(screen.getByRole("button", { name: /gold 완료/ })).toHaveAttribute("aria-pressed", "true"));

    const passport = await findPassport();
    const runRow = within(passport).getByText("실행 상태(전체)").closest("div")!;
    expect(runRow).toHaveTextContent("실패");

    const stageRow = within(passport).getByText("선택된 소스·단계 상태").closest("div")!;
    expect(within(stageRow).getByText("완료")).toBeInTheDocument();
    // 같은 값으로 뭉개지지 않는다 — run은 failed, 선택된 stage는 completed.
    expect(within(stageRow).queryByText("실패")).not.toBeInTheDocument();
  });

  it("labels the spec value as a digest/fingerprint, not a version string", async () => {
    renderDetail();
    const passport = await findPassport();
    expect(await within(passport).findByText("sha256:air14")).toBeInTheDocument();
    expect(within(passport).getByText("BuildSpec 다이제스트")).toBeInTheDocument();
    expect(within(passport).queryByText(/^v\d/)).not.toBeInTheDocument();
  });

  it("does not crash and uses the defined fallback ('확인 불가') for a run with no spec digest, instead of inventing one", async () => {
    renderDetail("/tables/population");
    await screen.findByLabelText("실행 선택");
    const passport = await findPassport();
    const digestRow = within(passport).getByText("BuildSpec 다이제스트").closest("div")!;
    expect(within(digestRow).getByText("확인 불가")).toBeInTheDocument();
  });

  it("shows the defined '제공되지 않음' fallback for schema when the selected stage carries no schema (bronze), without crashing", async () => {
    renderDetail("/tables/air-quality?stage=bronze");
    await screen.findByLabelText("실행 선택");
    const passport = await findPassport();
    const schemaRow = within(passport).getByText("스키마").closest("div")!;
    expect(await within(schemaRow).findByText("제공되지 않음")).toBeInTheDocument();
  });

  // Terms of use are shown since #645, read from the run's BuildSpec — see tableLicence.test.tsx.
  it("does not present fields absent from the contract, like freshness/verified score", async () => {
    renderDetail();
    const passport = await findPassport();
    expect(within(passport).queryByText(/freshness/i)).not.toBeInTheDocument();
    expect(within(passport).queryByText(/verified/i)).not.toBeInTheDocument();
    expect(within(passport).queryByText(/인증/)).not.toBeInTheDocument();
  });

  it("opens Ask KPubData with this dataset's context from the Passport entry point (#421)", async () => {
    renderDetail();
    const passport = await findPassport();
    fireEvent.click(within(passport).getByRole("button", { name: /Ask KPubData 가 이 테이블의 BuildSpec 수정안을 제안할 수 있습니다/ }));

    const drawer = await findAssistant();
    expect(within(drawer).getByText("air-quality")).toBeInTheDocument();
  });
});
