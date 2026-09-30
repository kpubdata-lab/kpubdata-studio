/**
 * Monitoring screen tests (#264, #302, #539).
 *
 * - Builder health as key-value rows (API, Queue, Workers, Snapshot store), no tabs (#539)
 * - real Builder contract (/monitoring/summary + /monitoring/builds)
 * - 401/403 is one line, not an empty screen (#539)
 * - no mock fallback when the real Builder fails (#302)
 * - unavailable/null never shown as 0 or healthy (#302 regression)
 * - recent refresh -> refresh detail navigation (#302)
 */
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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

function realBuilder(summary = summaryFixture(), builds = buildsFixture()) {
  vi.mocked(isRealBuilderEnabled).mockReturnValue(true);
  vi.mocked(builderApi.getMonitoringSummary).mockResolvedValue(summary);
  vi.mocked(builderApi.getMonitoringBuilds).mockResolvedValue(builds);
}

/** The value (`dd`) of the key-value row whose term (`dt`) is `term`. */
function valueOf(term: string): HTMLElement {
  const dt = screen.getByText(term, { selector: "dt" });
  const dd = dt.nextElementSibling;
  if (!(dd instanceof HTMLElement)) throw new Error(`no value for ${term}`);
  return dd;
}

describe("MonitoringPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isRealBuilderEnabled).mockReturnValue(false);
  });

  it("renders the one heading", async () => {
    renderMonitoring();
    expect(await screen.findByRole("heading", { level: 1, name: /시스템 모니터링/ })).toBeInTheDocument();
  });

  it("shows Builder health as key-value rows instead of tabs of cards (#539)", async () => {
    realBuilder();
    renderMonitoring();

    await screen.findByRole("heading", { name: "KPubData Builder 상태" });
    for (const term of ["KPubData Builder API", "큐", "워커", "스냅샷 저장소"]) {
      expect(screen.getByText(term, { selector: "dt" })).toBeInTheDocument();
    }
    expect(valueOf("KPubData Builder API")).toHaveTextContent("정상");
    expect(valueOf("KPubData Builder API")).toHaveTextContent("P95 지연200 ms");
    expect(valueOf("큐")).toHaveTextContent("대기 중3");
    expect(valueOf("워커")).toHaveTextContent("2 / 4");
    expect(valueOf("워커")).toHaveTextContent("50%");
    // Healthy is plain text, not a badge (#524).
    expect(valueOf("큐").querySelector('[data-status="normal"]')).toHaveTextContent("정상");
    expect(screen.getByRole("heading", { name: "최근 24시간 갱신" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "System Resources" })).not.toBeInTheDocument();
  });

  it("offers a 'refresh every 30 seconds' checkbox (#539)", async () => {
    realBuilder();
    renderMonitoring();

    const checkbox = await screen.findByRole("checkbox", { name: "30초마다 새로고침" });
    expect(checkbox).toBeChecked();
    fireEvent.click(checkbox);
    expect(checkbox).not.toBeChecked();
  });

  it("calls the two real Builder endpoints in parallel (#302)", async () => {
    realBuilder();
    renderMonitoring();

    await waitFor(() => {
      expect(builderApi.getMonitoringSummary).toHaveBeenCalled();
      expect(builderApi.getMonitoringBuilds).toHaveBeenCalled();
    });
  });

  it("says in one line that 401 needs permission, instead of an empty screen (#539)", async () => {
    vi.mocked(isRealBuilderEnabled).mockReturnValue(true);
    const { ApiError } = await vi.importActual<typeof import("@/shared/lib/builderApi")>(
      "@/shared/lib/builderApi",
    );
    vi.mocked(builderApi.getMonitoringSummary).mockRejectedValue(new ApiError(401, "unauthorized"));
    vi.mocked(builderApi.getMonitoringBuilds).mockResolvedValue(buildsFixture());

    renderMonitoring();

    expect(await screen.findByRole("status")).toHaveTextContent(
      "권한이 없습니다 — 모니터링을 보려면 운영자 권한이 있는 계정으로 로그인하세요.",
    );
    expect(screen.getByRole("heading", { level: 1, name: "시스템 모니터링" })).toBeInTheDocument();
    expect(screen.queryByText("KPubData Builder 상태")).not.toBeInTheDocument();
  });

  it("does not fall back to mock data when the real Builder fails (#302)", async () => {
    vi.mocked(isRealBuilderEnabled).mockReturnValue(true);
    vi.mocked(builderApi.getMonitoringSummary).mockRejectedValue(new Error("network down"));
    vi.mocked(builderApi.getMonitoringBuilds).mockRejectedValue(new Error("network down"));

    renderMonitoring();

    expect(await screen.findByRole("alert")).toHaveTextContent("데이터를 가져올 수 없습니다");
    // A mock run id on a failed real call would read as a healthy system.
    expect(screen.queryByText("run-001")).not.toBeInTheDocument();
  });

  it("does not show an unavailable API as healthy (#302 regression)", async () => {
    realBuilder(
      summaryFixture({
        status: "degraded",
        api: { availability: "unavailable", sample_count: null, p95_latency_ms: null },
      }),
    );
    renderMonitoring();

    await screen.findByText("KPubData Builder API", { selector: "dt" });
    const api = valueOf("KPubData Builder API");
    expect(api).not.toHaveTextContent("정상");
    expect(api.querySelector('[data-status="actionable"]')).toHaveTextContent("측정 불가");
    expect(api.querySelectorAll('[data-status="missing"]')).toHaveLength(2);
    expect(screen.getByText(/KPubData Builder 상태 저하/)).toBeInTheDocument();
  });

  it("shows a null queue measurement as —, not 0 (#302 regression)", async () => {
    realBuilder(
      summaryFixture({
        queue: { availability: "unavailable", waiting: null, running: null, total: null },
      }),
    );
    renderMonitoring();

    await screen.findByText("큐", { selector: "dt" });
    const queue = valueOf("큐");
    expect(queue.querySelectorAll('[data-status="missing"]')).toHaveLength(3);
    expect(queue).not.toHaveTextContent("0");
  });

  it("names the excluded count when the aggregate is partial (#302)", async () => {
    realBuilder(
      summaryFixture(),
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
    renderMonitoring();

    expect(await screen.findByText(/제외 2건/)).toBeInTheDocument();
    expect(valueOf("결과")).toHaveTextContent("성공3");
  });

  it("shows — for refresh counts when the aggregate could not be measured", async () => {
    realBuilder(summaryFixture(), buildsFixture({ availability: "unavailable" }));
    renderMonitoring();

    await screen.findByText("결과", { selector: "dt" });
    expect(valueOf("결과").querySelectorAll('[data-status="missing"]')).toHaveLength(3);
  });

  it("says in one line when there was no refresh", async () => {
    realBuilder();
    renderMonitoring();

    expect(await screen.findByText("최근 24시간 동안 갱신이 없습니다.")).toBeInTheDocument();
  });

  it("lists recent refreshes with run id, status and duration", async () => {
    realBuilder(
      summaryFixture(),
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
    renderMonitoring();

    const table = await screen.findByRole("table", { name: "최근 갱신" });
    const row = within(table).getByRole("row", { name: /run-abc/ });
    // BuildIndex's `ok` reads as succeeded.
    expect(row).toHaveTextContent("성공");
    expect(row).toHaveTextContent("1800초");
  });

  it("links a recent refresh to its detail (#302 navigation)", async () => {
    realBuilder(
      summaryFixture(),
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

    render(
      <MemoryRouter initialEntries={["/monitoring"]}>
        <Routes>
          <Route path="/monitoring" element={<MonitoringPage />} />
          <Route path="/refresh-jobs/:buildId" element={<LocationProbe />} />
        </Routes>
      </MemoryRouter>,
    );

    fireEvent.click(await screen.findByRole("link", { name: "run-nav" }));

    await waitFor(() => {
      expect(locationRef.current?.pathname).toBe("/refresh-jobs/run-nav");
    });
  });

  it("does not call the network in mock mode", async () => {
    renderMonitoring();

    await screen.findByRole("heading", { level: 1, name: /시스템 모니터링/ });
    expect(builderApi.getMonitoringSummary).not.toHaveBeenCalled();
    expect(builderApi.getMonitoringBuilds).not.toHaveBeenCalled();
  });
});
