import { act, render, screen, within } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAssistConfig } from "@/features/assistant/config";
import { useAssistantStore } from "@/features/assistant/useAssistantSession";
import { HomePage } from "@/pages/HomePage";
import { AssistantPage } from "@/pages/AssistantPage";
import { API_BASE } from "@/shared/config/env";
import { useUIStore } from "@/shared/hooks/useUIStore";
import { mswServer } from "../vitest.setup";
import { hideDemoWarehouse } from "./support/noWarehouse";

// 클라이언트가 실제로 부르는 base와 동일해야 한다(로컬 .env.local이 127.0.0.1로
// 덮어써도 msw 핸들러가 매칭되도록 하드코딩 대신 API_BASE에서 파생).
const BUILDER_BASE = API_BASE;

function mockEmptyBuilds() {
  mswServer.use(http.get(`${BUILDER_BASE}/builds`, () => HttpResponse.json({ builds: [] })));
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

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("HomePage (mock deployment, no warehouse)", () => {
  it("leads with tables that need attention, then recent runs, and says why there are no snapshots (#527)", async () => {
    hideDemoWarehouse();
    render(
      <MemoryRouter>
        <HomePage />
      </MemoryRouter>,
    );

    expect(await screen.findByRole("heading", { level: 1, name: "홈" })).toBeInTheDocument();
    // No KPI wall.
    expect(screen.queryByText("TABLES")).not.toBeInTheDocument();
    expect(screen.queryByText("RUNS SUCCEEDED (24H)")).not.toBeInTheDocument();

    const attention = await screen.findByRole("heading", { level: 2, name: "조치가 필요한 테이블" });
    const section = attention.closest("section")!;
    const air = within(section).getByRole("link", { name: /대기질 통합 데이터/ });
    expect(air).toHaveAttribute("href", "/tables/air-quality");
    expect(within(section).queryByText("행정구역별 인구")).not.toBeInTheDocument();

    expect(screen.getByText(/이 배포에는 warehouse 가 없어/)).toBeInTheDocument();
    expect(await screen.findByText("대기오염 정보")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "최근 분석" })).not.toBeInTheDocument();
  });

  it("points the new-user '테이블 만들기' CTA at the canonical /add route, not /add-data (#regression)", async () => {
    useEmptyBuildsRealMode();

    render(
      <MemoryRouter>
        <HomePage />
      </MemoryRouter>,
    );

    const cta = await screen.findByRole("link", { name: "테이블 만들기" });
    expect(cta).toHaveAttribute("href", "/add");
  });
});

describe("Home without an Ask KPubData hero (#421)", () => {
  beforeEach(() => {
    useAssistantStore.setState({ turns: [], onboarded: false, pendingSeed: null });
    useAssistConfig.getState().clear();
    act(() => useUIStore.setState({ isAssistantDrawerOpen: false }));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    localStorage.clear();
  });

  // Ask KPubData is a feature reached from the topbar and each screen's context, not a Home hero.
  it("does not show an Ask KPubData hero to a new user", async () => {
    useEmptyBuildsRealMode();
    render(
      <MemoryRouter>
        <HomePage />
      </MemoryRouter>,
    );
    await screen.findByRole("link", { name: "테이블 만들기" });
    // The hero was a question box; Home alone (no topbar) now has none.
    expect(screen.queryByRole("searchbox")).not.toBeInTheDocument();
  });

  it("does not show an Ask KPubData hero on the existing-user dashboard", async () => {
    render(
      <MemoryRouter>
        <HomePage />
      </MemoryRouter>,
    );
    await screen.findByRole("heading", { level: 1, name: "홈" });
    expect(screen.queryByRole("searchbox")).not.toBeInTheDocument();
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
