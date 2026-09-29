import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAssistConfig } from "@/features/assistant/config";
import { START_QUESTIONS } from "@/features/assistant/suggestedQuestions";
import { useAssistantStore } from "@/features/assistant/useAssistantSession";
import { HomePage } from "@/pages/HomePage";
import { AssistantPage } from "@/pages/AssistantPage";
import { builderApi } from "@/shared/lib/builderApi";
import { API_BASE } from "@/shared/config/env";
import { useUIStore } from "@/shared/hooks/useUIStore";
import { mswServer } from "../vitest.setup";

// 클라이언트가 실제로 부르는 base와 동일해야 한다(로컬 .env.local이 127.0.0.1로
// 덮어써도 msw 핸들러가 매칭되도록 하드코딩 대신 API_BASE에서 파생).
const BUILDER_BASE = API_BASE;

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

function mockEmptyBuilds() {
  mswServer.use(http.get(`${BUILDER_BASE}/builds`, () => HttpResponse.json({ builds: [] })));
}

/**
 * dataset total / quality summary aggregate를 미지원(구버전 Builder)으로 고정한다.
 * 두 KPI는 "확인 불가"가 되어야 하며 임의 0/PASS로 합성되면 안 된다. real 모드에서
 * HomePage가 항상 이 둘을 조회하므로, 다른 KPI를 검증하는 테스트도 명시적으로 stub한다.
 */
function mockDashboardAggregatesUnsupported() {
  mswServer.use(
    http.get(`${BUILDER_BASE}/datasets`, () => HttpResponse.json({ datasets: [] })),
    http.get(`${BUILDER_BASE}/quality/summary`, () => new HttpResponse(null, { status: 404 })),
  );
}

/**
 * mock 모드(`VITE_USE_REAL_BUILDER` 미설정)의 `listBuilds()`는 결정적 데모 데이터
 * (DEMO_DATASETS, 항상 succeeded 빌드 포함)를 반환하고 msw를 아예 거치지 않는다
 * (features/runs/api/index.ts) — 그래서 신규 사용자(빌드 0개) 상태를 결정적으로 재현하려면
 * 실제 Builder 연동 모드로 전환해 `/builds` 응답 자체를 msw로 통제해야 한다.
 *
 * 신규 사용자 = 빌드 0개 **그리고** authoritative dataset total 0. real 모드에서는
 * dataset total이 확인돼야(GET /datasets `total: 0`) NewUserHome이 렌더된다 —
 * total을 확인할 수 없으면 빈 build만으로 신규 사용자로 추측하지 않기 때문이다.
 */
function useEmptyBuildsRealMode() {
  vi.stubEnv("VITE_USE_REAL_BUILDER", "true");
  mockEmptyBuilds();
  mswServer.use(
    http.get(`${BUILDER_BASE}/datasets`, () => HttpResponse.json({ datasets: [], total: 0 })),
  );
}

function configureKey() {
  act(() => {
    useAssistConfig.getState().setConfig({ apiKey: "sk-test-key", model: "gpt-4o-mini", baseUrl: "" });
  });
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("HomePage", () => {
  it("renders the existing-user dashboard heading and KPI summary once builds load (#248)", async () => {
    render(
      <MemoryRouter>
        <HomePage />
      </MemoryRouter>,
    );

    // mock 빌드 이력에 성공한 빌드가 있어 기존 사용자 대시보드(ExistingUserHome)가 렌더된다.
    expect(
      await screen.findByRole("heading", {
        name: "작업 현황을 한눈에 확인하세요",
      }),
    ).toBeInTheDocument();
    // 상태 요약 KPI 카드 라벨
    expect(screen.getByText("DATASETS")).toBeInTheDocument();
    expect(screen.getByText("SUCCEEDED (24H)")).toBeInTheDocument();
    expect(screen.getByText("RUNNING")).toBeInTheDocument();
  });

  it("loads recent builds from the mock builder data", async () => {
    render(
      <MemoryRouter>
        <HomePage />
      </MemoryRouter>,
    );

    // 데모 빌드 이력이 최근 빌드 목록에 표시된다.
    expect(await screen.findByText("대기오염 정보")).toBeInTheDocument();
    // 각 빌드 행에서 상세로 이동하는 링크가 있다.
    expect(
      screen.getAllByRole("link", { name: "보기" }).length,
    ).toBeGreaterThanOrEqual(1);
  });

  it("points the new-user '데이터 추가하기' CTA at the canonical /add route, not /add-data (#regression)", async () => {
    useEmptyBuildsRealMode();

    render(
      <MemoryRouter>
        <HomePage />
      </MemoryRouter>,
    );

    const cta = await screen.findByRole("link", { name: "데이터 추가하기" });
    expect(cta).toHaveAttribute("href", "/add");
  });

  it("uses monitoring success counts and renders unavailable metrics as unavailable, never zero/PASS", async () => {
    vi.stubEnv("VITE_USE_REAL_BUILDER", "true");
    mswServer.use(
      http.get(`${BUILDER_BASE}/builds`, () => HttpResponse.json({
        builds: [
          { run_id: "ok-run", status: "ok", started_at: "2026-08-31T00:00:00Z", finished_at: "2026-08-31T00:01:00Z" },
          { run_id: "failed-run", status: "failed", started_at: "2026-08-31T00:02:00Z", finished_at: "2026-08-31T00:03:00Z" },
          { run_id: "cancelled-run", status: "cancelled", started_at: "2026-08-31T00:04:00Z", finished_at: "2026-08-31T00:05:00Z" },
        ],
      })),
      http.get(`${BUILDER_BASE}/monitoring/builds`, () => HttpResponse.json({
        window: "24h",
        bucket: "hour",
        availability: "available",
        excluded_count: 0,
        buckets: [{ bucket_start: "2026-08-31T00:00:00Z", bucket_end: "2026-08-31T01:00:00Z", total: 9, success: 7, failed: 1, cancelled: 1 }],
        recent_runs: [],
      })),
      http.get(`${BUILDER_BASE}/monitoring/summary`, () => HttpResponse.json({
        generated_at: "2026-08-31T00:00:00Z",
        status: "healthy",
        api: { availability: "available", sample_count: 1, p95_latency_ms: 10 },
        queue: { availability: "available", waiting: 0, running: 3, total: 3 },
        workers: { availability: "available", active: 1, capacity: 1, utilization: 1 },
        artifact_store: { availability: "available", last_write_at: null },
      })),
      http.get(`${BUILDER_BASE}/builds/ok-run/quality`, () => new HttpResponse(null, { status: 404 })),
    );
    mockDashboardAggregatesUnsupported();

    render(<MemoryRouter><HomePage /></MemoryRouter>);

    expect(await screen.findByText("7")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.getAllByText("확인 불가")).toHaveLength(2);
    expect(await screen.findByText("일부 품질 정보를 확인할 수 없습니다")).toBeInTheDocument();
    expect(screen.queryByText("품질 경고가 없습니다")).not.toBeInTheDocument();
    expect(screen.queryByText("모든 빌드가 정상적으로 완료되었습니다")).not.toBeInTheDocument();
  });

  it("renders recent builds before deferred monitoring settles, then uses authoritative KPIs", async () => {
    vi.stubEnv("VITE_USE_REAL_BUILDER", "true");
    const monitoringBuilds = deferred<Response>();
    const monitoringSummary = deferred<Response>();
    mswServer.use(
      http.get(`${BUILDER_BASE}/builds`, () => HttpResponse.json({ builds: [
        { run_id: "deferred-run", status: "ok", started_at: "2026-08-31T00:00:00Z", finished_at: null },
      ] })),
      http.get(`${BUILDER_BASE}/monitoring/builds`, () => monitoringBuilds.promise),
      http.get(`${BUILDER_BASE}/monitoring/summary`, () => monitoringSummary.promise),
    );
    mockDashboardAggregatesUnsupported();
    render(<MemoryRouter><HomePage /></MemoryRouter>);
    expect(await screen.findByText("deferred-run")).toBeInTheDocument();
    expect(screen.queryByText(/빌드 목록을 불러오지 못했습니다/)).not.toBeInTheDocument();
    await act(async () => {
      monitoringBuilds.resolve(HttpResponse.json({ window: "24h", bucket: "hour", availability: "available", excluded_count: 0, buckets: [{ bucket_start: "2026-08-31T00:00:00Z", bucket_end: "2026-08-31T01:00:00Z", total: 4, success: 4, failed: 0, cancelled: 0 }], recent_runs: [] }));
      monitoringSummary.resolve(HttpResponse.json({ generated_at: "2026-08-31T00:00:00Z", status: "healthy", api: { availability: "available", sample_count: 1, p95_latency_ms: 1 }, queue: { availability: "available", waiting: 0, running: 3, total: 3 }, workers: { availability: "available", active: 1, capacity: 1, utilization: 1 }, artifact_store: { availability: "available", last_write_at: null } }));
    });
    expect(await screen.findByText("4")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
  });

  it("keeps recent builds visible when monitoring fails and marks only KPIs unavailable", async () => {
    vi.stubEnv("VITE_USE_REAL_BUILDER", "true");
    mswServer.use(
      http.get(`${BUILDER_BASE}/builds`, () => HttpResponse.json({ builds: [{ run_id: "still-visible", status: "ok", started_at: "2026-08-31T00:00:00Z", finished_at: null }] })),
    );
    mockDashboardAggregatesUnsupported();
    vi.spyOn(builderApi, "getMonitoringBuilds").mockRejectedValue(new Error("monitoring down"));
    vi.spyOn(builderApi, "getMonitoringSummary").mockRejectedValue(new Error("monitoring down"));
    render(<MemoryRouter><HomePage /></MemoryRouter>);
    expect(await screen.findByText("still-visible")).toBeInTheDocument();
    await waitFor(() => expect(screen.getAllByText("확인 불가")).toHaveLength(4));
    expect(screen.queryByText(/빌드 목록을 불러오지 못했습니다/)).not.toBeInTheDocument();
  });
});

const HERO_HEADING = "어디서 시작할지 모르겠다면 Ask KPubData";

/** Home과 /assistant를 함께 마운트해 Home hero의 이동 대상을 관측한다. */
function renderHomeWithAssistantRoute() {
  return render(
    <MemoryRouter initialEntries={["/"]}>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/assistant" element={<div>ASSISTANT ROUTE STUB</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("Home Ask KPubData Hero (#Phase2 UI polish, #S-assistant-suggest)", () => {
  beforeEach(() => {
    useAssistantStore.setState({ turns: [], onboarded: false, pendingSeed: null });
    useAssistConfig.getState().clear();
    act(() => useUIStore.setState({ isAssistantDrawerOpen: false }));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    localStorage.clear();
  });

  it("shows the Ask KPubData hero only for a new user (no builds/datasets), not on the existing-user dashboard", async () => {
    // 기존 사용자(데모 빌드 이력 존재) — ExistingUserHome에는 Hero가 중복 노출되지 않는다.
    render(
      <MemoryRouter>
        <HomePage />
      </MemoryRouter>,
    );
    await screen.findByRole("heading", { name: "작업 현황을 한눈에 확인하세요" });
    expect(screen.queryByRole("heading", { name: HERO_HEADING })).not.toBeInTheDocument();
  });

  it("shows exactly one Ask KPubData hero for a new user (empty builds/datasets)", async () => {
    useEmptyBuildsRealMode();
    render(
      <MemoryRouter>
        <HomePage />
      </MemoryRouter>,
    );
    expect(await screen.findAllByRole("heading", { name: HERO_HEADING })).toHaveLength(1);
  });

  it("configured: submitting a question seeds it and navigates to /assistant (not the drawer)", async () => {
    useEmptyBuildsRealMode();
    configureKey();
    renderHomeWithAssistantRoute();
    const input = await screen.findByLabelText("Ask KPubData 에 자연어로 데이터 물어보기");
    fireEvent.change(input, { target: { value: "서울 대기오염 데이터로 뭘 할 수 있어?" } });
    fireEvent.submit(input.closest("form")!);

    expect(await screen.findByText("ASSISTANT ROUTE STUB")).toBeInTheDocument();
    expect(useAssistantStore.getState().pendingSeed).toBe("서울 대기오염 데이터로 뭘 할 수 있어?");
    expect(useUIStore.getState().isAssistantDrawerOpen).toBe(false);
  });

  it("not configured: navigates to /assistant without seeding a question or creating a no_key turn", async () => {
    useEmptyBuildsRealMode();
    renderHomeWithAssistantRoute();
    const input = await screen.findByLabelText("Ask KPubData 에 자연어로 데이터 물어보기");
    fireEvent.change(input, { target: { value: "서울 대기오염 데이터로 뭘 할 수 있어?" } });
    fireEvent.submit(input.closest("form")!);

    expect(await screen.findByText("ASSISTANT ROUTE STUB")).toBeInTheDocument();
    expect(useUIStore.getState().isAssistantDrawerOpen).toBe(false);
    expect(useAssistantStore.getState().pendingSeed).toBeNull();
    expect(useAssistantStore.getState().turns).toHaveLength(0);
  });

  it("configured: clicking a suggested-question chip seeds it and navigates to /assistant", async () => {
    useEmptyBuildsRealMode();
    configureKey();
    renderHomeWithAssistantRoute();
    const chip = await screen.findByRole("button", { name: START_QUESTIONS[0] });
    fireEvent.click(chip);

    expect(await screen.findByText("ASSISTANT ROUTE STUB")).toBeInTheDocument();
    expect(useAssistantStore.getState().pendingSeed).toBe(START_QUESTIONS[0]);
    expect(useUIStore.getState().isAssistantDrawerOpen).toBe(false);
  });

  it("hero chips no longer surface Quality/Build-failure/SQL questions with no context", async () => {
    useEmptyBuildsRealMode();
    render(
      <MemoryRouter>
        <HomePage />
      </MemoryRouter>,
    );
    await screen.findByRole("heading", { name: HERO_HEADING });
    expect(screen.queryByRole("button", { name: /Build.*실패/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Quality 이슈/ })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: START_QUESTIONS[0] })).toBeInTheDocument();
  });

  it("empty/whitespace query: does not seed a question or create a turn", async () => {
    useEmptyBuildsRealMode();
    configureKey();
    renderHomeWithAssistantRoute();
    const input = await screen.findByLabelText("Ask KPubData 에 자연어로 데이터 물어보기");
    fireEvent.change(input, { target: { value: "   " } });
    fireEvent.submit(input.closest("form")!);

    expect(useAssistantStore.getState().pendingSeed).toBeNull();
    expect(useAssistantStore.getState().turns).toHaveLength(0);
  });

  it("seeded question renders as a user turn once the Ask KPubData page mounts", async () => {
    useEmptyBuildsRealMode();
    useAssistantStore.setState({ turns: [], onboarded: false, pendingSeed: "서울 대기오염 데이터로 뭘 할 수 있어?" });
    render(
      <MemoryRouter initialEntries={["/assistant"]}>
        <AssistantPage />
      </MemoryRouter>,
    );
    // BYOK 미설정이라 no_key 에러 turn이 되지만, 질문 자체는 user turn으로 표시된다(네트워크 없음).
    expect(await screen.findByText("서울 대기오염 데이터로 뭘 할 수 있어?")).toBeInTheDocument();
  });
});
