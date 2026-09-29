/**
 * Monitoring 화면 테스트 (#264, #302).
 *
 * - system/builds/recent-runs 탭 렌더링
 * - 실제 Builder 계약(/monitoring/summary + /monitoring/builds) 기준 데이터 표시
 * - 401은 권한 없음 상태로 구분(실API 응답 기준, #302)
 * - 실연동 실패 시 mock 폴백 없음(정상 오인 방지, #302)
 * - unavailable/null을 0/정상으로 표시하지 않음(#302 회귀 테스트)
 * - recent run → Builds 상세 네비게이션(#302)
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { MonitoringPage } from "@/pages/MonitoringPage";
import { builderApi, isRealBuilderEnabled } from "@/shared/lib/builderApi";
import type {
  MonitoringSummaryResponse,
  MonitoringBuildsResponse,
} from "@/shared/lib/builderApi.schema";

vi.mock("@/shared/lib/builderApi", async () => {
  const actual = await vi.importActual<typeof import("@/shared/lib/builderApi")>(
    "@/shared/lib/builderApi",
  );
  return {
    ...actual,
    isRealBuilderEnabled: vi.fn(() => false),
    builderApi: {
      getMonitoringSummary: vi.fn(),
      getMonitoringBuilds: vi.fn(),
    },
  };
});

function setupUserEvent() {
  return {
    user: {
      click: async (element: Element) => {
        fireEvent.click(element);
      },
    },
  };
}

function summaryFixture(
  overrides: Partial<MonitoringSummaryResponse> = {},
): MonitoringSummaryResponse {
  return {
    generated_at: "2026-08-20T00:00:00+00:00",
    status: "healthy",
    api: { availability: "available", sample_count: 10, p95_latency_ms: 200 },
    queue: { availability: "available", waiting: 3, running: 2, total: 5 },
    workers: { availability: "available", active: 2, capacity: 4, utilization: 0.5 },
    artifact_store: { availability: "available", last_write_at: "2026-08-20T00:00:00+00:00" },
    ...overrides,
  };
}

function buildsFixture(
  overrides: Partial<MonitoringBuildsResponse> = {},
): MonitoringBuildsResponse {
  return {
    window: "24h",
    bucket: "hour",
    availability: "available",
    excluded_count: 0,
    buckets: [],
    recent_runs: [],
    ...overrides,
  };
}

function renderMonitoring() {
  return render(
    <MemoryRouter initialEntries={["/monitoring"]}>
      <MonitoringPage />
    </MemoryRouter>,
  );
}

describe("MonitoringPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isRealBuilderEnabled).mockReturnValue(false);
  });

  it("기본 제목과 설명을 렌더링한다", async () => {
    renderMonitoring();

    await waitFor(() => {
      expect(
        screen.getByRole("heading", { name: /시스템 모니터링/ }),
      ).toBeInTheDocument();
    });
  });

  it("system/builds/recent-runs 탭을 렌더링한다", async () => {
    renderMonitoring();

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "System Resources" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Build Statistics" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Recent Runs" })).toBeInTheDocument();
    });
  });

  it("탭 전환이 정상적으로 작동한다", async () => {
    const { user } = setupUserEvent();
    renderMonitoring();

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "System Resources" }).className).toContain(
        "border-b-2",
      );
    });

    await user.click(screen.getByRole("button", { name: "Build Statistics" }));

    expect(screen.getByRole("button", { name: "Build Statistics" }).className).toContain(
      "border-b-2",
    );
    expect(
      screen.getByRole("button", { name: "System Resources" }).className,
    ).not.toContain("border-b-2");
  });

  it("실연동 모드에서 실제 Builder 엔드포인트 2개를 병렬 호출한다 (#302)", async () => {
    vi.mocked(isRealBuilderEnabled).mockReturnValue(true);
    vi.mocked(builderApi.getMonitoringSummary).mockResolvedValue(summaryFixture());
    vi.mocked(builderApi.getMonitoringBuilds).mockResolvedValue(buildsFixture());

    renderMonitoring();

    await waitFor(() => {
      expect(builderApi.getMonitoringSummary).toHaveBeenCalled();
      expect(builderApi.getMonitoringBuilds).toHaveBeenCalled();
    });
  });

  it("401 응답은 권한 없음 상태로 구분한다 — 실API 응답 기준 (#302)", async () => {
    vi.mocked(isRealBuilderEnabled).mockReturnValue(true);
    const { ApiError } = await vi.importActual<typeof import("@/shared/lib/builderApi")>(
      "@/shared/lib/builderApi",
    );
    vi.mocked(builderApi.getMonitoringSummary).mockRejectedValue(
      new ApiError(401, "인증이 필요합니다"),
    );
    vi.mocked(builderApi.getMonitoringBuilds).mockResolvedValue(buildsFixture());

    renderMonitoring();

    await waitFor(() => {
      expect(screen.getByText("권한이 없습니다")).toBeInTheDocument();
    });
    expect(builderApi.getMonitoringBuilds).toHaveBeenCalled();
  });

  it("실연동 실패 시 mock 데이터로 대체하지 않는다 (#302)", async () => {
    vi.mocked(isRealBuilderEnabled).mockReturnValue(true);
    vi.mocked(builderApi.getMonitoringSummary).mockRejectedValue(new Error("network down"));
    vi.mocked(builderApi.getMonitoringBuilds).mockRejectedValue(new Error("network down"));

    renderMonitoring();

    await waitFor(() => {
      expect(screen.getByText("데이터를 가져올 수 없습니다")).toBeInTheDocument();
    });
    // mock fixture의 run id가 실연동 실패 화면에 나타나면 정상 오인이다.
    expect(screen.queryByText("run-001")).not.toBeInTheDocument();
  });

  it("api가 unavailable이면 정상으로 표시하지 않는다 (#302 회귀)", async () => {
    vi.mocked(isRealBuilderEnabled).mockReturnValue(true);
    vi.mocked(builderApi.getMonitoringSummary).mockResolvedValue(
      summaryFixture({
        status: "degraded",
        api: { availability: "unavailable", sample_count: null, p95_latency_ms: null },
      }),
    );
    vi.mocked(builderApi.getMonitoringBuilds).mockResolvedValue(buildsFixture());

    renderMonitoring();

    await waitFor(() => {
      expect(screen.getByText("사용 불가")).toBeInTheDocument();
    });
    // Builder API 카드의 배지가 정상이어선 안 된다(Artifact Store의 정상 배지와 구분).
    const apiCard = screen.getByText("Engine API").closest("div")?.parentElement?.parentElement;
    expect(apiCard).not.toBeNull();
    expect(apiCard?.textContent).not.toContain("정상");
    expect(screen.getByText(/측정 불가/)).toBeInTheDocument();
  });

  it("queue 측정값이 null이면 0이 아니라 — 로 표시한다 (#302 회귀)", async () => {
    vi.mocked(isRealBuilderEnabled).mockReturnValue(true);
    vi.mocked(builderApi.getMonitoringSummary).mockResolvedValue(
      summaryFixture({
        queue: { availability: "unavailable", waiting: null, running: null, total: null },
      }),
    );
    vi.mocked(builderApi.getMonitoringBuilds).mockResolvedValue(buildsFixture());

    renderMonitoring();

    await waitFor(() => {
      expect(screen.getByText("Queue")).toBeInTheDocument();
    });
    // 대기/실행/전체가 전부 —(측정 불가)이고 0으로 표시되지 않는다.
    const queueSection = screen.getByText("대기 중").closest("div")?.parentElement;
    expect(queueSection).not.toBeNull();
    expect(screen.getAllByText("—").length).toBeGreaterThanOrEqual(3);
  });

  it("partial 집계는 제외 건수와 함께 안내한다 (#302)", async () => {
    vi.mocked(isRealBuilderEnabled).mockReturnValue(true);
    vi.mocked(builderApi.getMonitoringSummary).mockResolvedValue(summaryFixture());
    vi.mocked(builderApi.getMonitoringBuilds).mockResolvedValue(
      buildsFixture({
        availability: "partial",
        excluded_count: 2,
        buckets: [
          {
            bucket_start: "2026-08-20T01:00:00+00:00",
            bucket_end: "2026-08-20T02:00:00+00:00",
            total: 3,
            success: 3,
            failed: 0,
            cancelled: 0,
          },
        ],
      }),
    );

    const { user } = setupUserEvent();
    renderMonitoring();

    await user.click(await screen.findByRole("button", { name: "Build Statistics" }));

    await waitFor(() => {
      expect(screen.getByText(/제외 2건/)).toBeInTheDocument();
    });
  });

  it("빈 데이터일 때 empty state를 표시한다", async () => {
    vi.mocked(isRealBuilderEnabled).mockReturnValue(true);
    vi.mocked(builderApi.getMonitoringSummary).mockResolvedValue(summaryFixture());
    vi.mocked(builderApi.getMonitoringBuilds).mockResolvedValue(buildsFixture());

    const { user } = setupUserEvent();
    renderMonitoring();

    await user.click(await screen.findByRole("button", { name: "Build Statistics" }));

    await waitFor(() => {
      expect(screen.getByText(/빌드 기록이 없습니다/)).toBeInTheDocument();
    });
  });

  it("recent runs 탭에서 run_id·상태·소요시간을 표시한다", async () => {
    vi.mocked(isRealBuilderEnabled).mockReturnValue(true);
    vi.mocked(builderApi.getMonitoringSummary).mockResolvedValue(summaryFixture());
    vi.mocked(builderApi.getMonitoringBuilds).mockResolvedValue(
      buildsFixture({
        recent_runs: [
          {
            run_id: "run-abc",
            status: "ok",
            started_at: "2026-08-20T00:00:00+00:00",
            finished_at: "2026-08-20T00:30:00+00:00",
          },
        ],
      }),
    );

    const { user } = setupUserEvent();
    renderMonitoring();

    await user.click(await screen.findByRole("button", { name: "Recent Runs" }));

    expect(await screen.findByText("run-abc")).toBeInTheDocument();
    // BuildIndex 내부 값 ok는 성공으로 표시한다.
    expect(screen.getByText("성공")).toBeInTheDocument();
    expect(screen.getByText(/1800초/)).toBeInTheDocument();
  });

  it("recent run의 보기 링크가 Builds 상세로 이동한다 (#302 네비게이션)", async () => {
    vi.mocked(isRealBuilderEnabled).mockReturnValue(true);
    vi.mocked(builderApi.getMonitoringSummary).mockResolvedValue(summaryFixture());
    vi.mocked(builderApi.getMonitoringBuilds).mockResolvedValue(
      buildsFixture({
        recent_runs: [
          {
            run_id: "run-nav",
            status: "ok",
            started_at: "2026-08-20T00:00:00+00:00",
            finished_at: "2026-08-20T00:10:00+00:00",
          },
        ],
      }),
    );

    const locationRef: { current: { pathname: string } | null } = { current: null };
    function LocationProbe() {
      locationRef.current = useLocation();
      return null;
    }

    const { user } = setupUserEvent();
    render(
      <MemoryRouter initialEntries={["/monitoring"]}>
        <Routes>
          <Route path="/monitoring" element={<MonitoringPage />} />
          <Route path="/builds/:buildId" element={<LocationProbe />} />
        </Routes>
      </MemoryRouter>,
    );

    await user.click(await screen.findByRole("button", { name: "Recent Runs" }));
    const viewLink = await screen.findByRole("link", { name: "보기" });
    await user.click(viewLink);

    await waitFor(() => {
      expect(locationRef.current).not.toBeNull();
    });
    expect(locationRef.current?.pathname).toBe("/builds/run-nav");
  });

  it("mock 모드에서는 네트워크를 호출하지 않는다", async () => {
    renderMonitoring();

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: /시스템 모니터링/ })).toBeInTheDocument();
    });
    expect(builderApi.getMonitoringSummary).not.toHaveBeenCalled();
    expect(builderApi.getMonitoringBuilds).not.toHaveBeenCalled();
  });
});
