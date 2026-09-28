/**
 * Home dashboard KPI wiring test.
 *
 * Validation targets:
 * - DATASETS → authoritative `total` from GET /datasets (Builder 1.22.0)
 * - QUALITY WARN (24H) → `warn_runs` from GET /quality/summary
 * - Each aggregate boundary is independent — one failure doesn't affect other KPIs and Recent Builds
 * - Recent Builds renders in its own state regardless of KPI request delay/failure
 * - For older Builder versions (not sending `total`), only DATASETS is marked "verification unavailable"
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { http, HttpResponse, delay } from "msw";
import { mswServer } from "../../vitest.setup";
import { API_BASE } from "@/shared/config/env";
import { HomePage } from "./HomePage";
import { useAuthStore } from "@/features/auth/store";

const BUILDS = [
  { run_id: "r1", status: "ok", started_at: "2026-09-01T08:00:00+00:00", finished_at: "2026-09-01T08:05:00+00:00" },
];

const MONITORING_BUILDS = {
  window: "24h",
  bucket: "hour",
  availability: "available",
  excluded_count: 0,
  buckets: [
    {
      bucket_start: "2026-09-01T08:00:00+00:00",
      bucket_end: "2026-09-01T09:00:00+00:00",
      total: 9,
      success: 9,
      failed: 0,
      cancelled: 0,
    },
  ],
  recent_runs: [],
};

const MONITORING_SUMMARY = {
  generated_at: "2026-09-01T09:00:00+00:00",
  status: "healthy",
  api: { availability: "available", sample_count: 10, p95_latency_ms: 5 },
  queue: { availability: "available", waiting: 0, running: 3, total: 3 },
  workers: { availability: "available", active: 0, capacity: 4, utilization: 0 },
  artifact_store: { availability: "available", last_write_at: null },
};

const QUALITY_SUMMARY = {
  window: "24h",
  generated_at: "2026-09-01T09:00:00+00:00",
  availability: "available",
  total_runs: 7,
  evaluated_runs: 6,
  pass_runs: 2,
  warn_runs: 4,
  fail_runs: 1,
};

/** basic: all boundaries are normal. Override only what needs individual test. */
function baseHandlers(overrides: {
  builds?: () => Response | Promise<Response>;
  datasets?: () => Response | Promise<Response>;
  monitoringBuilds?: () => Response | Promise<Response>;
  monitoringSummary?: () => Response | Promise<Response>;
  quality?: () => Response | Promise<Response>;
  qualityDetail?: (runId: string) => Response | Promise<Response>;
} = {}) {
  mswServer.use(
    http.get(`${API_BASE}/builds`, overrides.builds ?? (() => HttpResponse.json({ builds: BUILDS }))),
    http.get(
      `${API_BASE}/datasets`,
      overrides.datasets ?? (() => HttpResponse.json({ datasets: [], total: 12 })),
    ),
    http.get(
      `${API_BASE}/monitoring/builds`,
      overrides.monitoringBuilds ?? (() => HttpResponse.json(MONITORING_BUILDS)),
    ),
    http.get(
      `${API_BASE}/monitoring/summary`,
      overrides.monitoringSummary ?? (() => HttpResponse.json(MONITORING_SUMMARY)),
    ),
    http.get(
      `${API_BASE}/quality/summary`,
      overrides.quality ?? (() => HttpResponse.json(QUALITY_SUMMARY)),
    ),
    http.get(`${API_BASE}/builds/:runId/quality`, ({ params }) =>
      overrides.qualityDetail?.(String(params.runId)) ??
      HttpResponse.json({
        run_id: String(params.runId),
        availability: "available",
        evaluated_checks: 0,
        quality_results: {},
        schema_drift: {},
      }),
    ),
  );
}

function renderHome() {
  return render(
    <MemoryRouter>
      <HomePage />
      <CurrentPath />
    </MemoryRouter>,
  );
}

function CurrentPath() {
  return <output data-testid="current-path">{useLocation().pathname}</output>;
}

/** Returns card containing KPI label (parent of label span). */
function kpiCard(label: string) {
  return screen.getByText(label).parentElement as HTMLElement;
}

beforeEach(() => {
  vi.stubEnv("VITE_USE_REAL_BUILDER", "true");
});

describe("Existing Dashboard 사용 가이드", () => {
  it("navigating to Discover 없이 현재 계정의 guide tour를 수동으로 연다", async () => {
    useAuthStore.setState({ userId: "keycloak-subject-existing" });
    baseHandlers();
    renderHome();

    const guide = await screen.findByRole("button", { name: "사용 가이드" });
    expect(screen.queryByRole("link", { name: "사용 가이드" })).not.toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    fireEvent.click(guide);

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByTestId("current-path")).toHaveTextContent("/");
    useAuthStore.getState().clear();
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("HomePage 대시보드 KPI", () => {
  it("DATASETS는 GET /datasets의 authoritative total을, QUALITY WARN은 warn_runs를 보여준다", async () => {
    baseHandlers();
    renderHome();

    expect(await within(kpiCard("DATASETS")).findByText("12")).toBeInTheDocument();
    expect(await within(kpiCard("QUALITY WARN (24H)")).findByText("4")).toBeInTheDocument();
    expect(await within(kpiCard("SUCCEEDED (24H)")).findByText("9")).toBeInTheDocument();
    expect(await within(kpiCard("RUNNING")).findByText("3")).toBeInTheDocument();
  });

  it("dataset aggregate 실패는 DATASETS만 '확인 불가'로 만들고 나머지 KPI는 유지한다", async () => {
    baseHandlers({ datasets: () => HttpResponse.json({ error: "boom" }, { status: 500 }) });
    renderHome();

    expect(await within(kpiCard("QUALITY WARN (24H)")).findByText("4")).toBeInTheDocument();
    expect(await within(kpiCard("SUCCEEDED (24H)")).findByText("9")).toBeInTheDocument();
    // 5xx retries with exponential backoff in apiFetch, so catch takes time.
    expect(
      await within(kpiCard("DATASETS")).findByText("확인 불가", undefined),
    ).toBeInTheDocument();
  });

  it("quality aggregate 404(구버전 Builder)는 QUALITY WARN만 '확인 불가'로 만든다", async () => {
    baseHandlers({ quality: () => HttpResponse.json({ error: "not found" }, { status: 404 }) });
    renderHome();

    expect(await within(kpiCard("DATASETS")).findByText("12")).toBeInTheDocument();
    expect(await within(kpiCard("SUCCEEDED (24H)")).findByText("9")).toBeInTheDocument();
    expect(within(kpiCard("QUALITY WARN (24H)")).getByText("확인 불가")).toBeInTheDocument();
  });

  it("monitoring 실패는 monitoring KPI만 degraded로 만들고 DATASETS/QUALITY WARN은 유지한다", async () => {
    baseHandlers({
      monitoringBuilds: () => HttpResponse.json({ error: "x" }, { status: 500 }),
      monitoringSummary: () => HttpResponse.json({ error: "x" }, { status: 500 }),
    });
    renderHome();

    expect(await within(kpiCard("DATASETS")).findByText("12")).toBeInTheDocument();
    expect(await within(kpiCard("QUALITY WARN (24H)")).findByText("4")).toBeInTheDocument();
    expect(
      await within(kpiCard("SUCCEEDED (24H)")).findByText("확인 불가", undefined),
    ).toBeInTheDocument();
    expect(within(kpiCard("RUNNING")).getByText("확인 불가")).toBeInTheDocument();
  });

  it("total을 안 보내는 Builder에서는 DATASETS만 '확인 불가'이고 items.length로 대체하지 않는다", async () => {
    baseHandlers({
      datasets: () =>
        HttpResponse.json({
          datasets: [
            {
              dataset_id: "d.a",
              title: "A",
              sources: [],
              latest_run_id: "r1",
              status: "ok",
              updated_at: null,
              row_counts: {},
              total_row_count: 0,
              stages: {},
              quality: null,
            },
          ],
        }),
    });
    renderHome();

    expect(await within(kpiCard("QUALITY WARN (24H)")).findByText("4")).toBeInTheDocument();
    expect(await within(kpiCard("DATASETS")).findByText("확인 불가")).toBeInTheDocument();
    expect(within(kpiCard("DATASETS")).queryByText("1")).not.toBeInTheDocument();
  });

  it("Recent Builds는 KPI 요청이 지연돼도 자기 데이터를 즉시 렌더한다", async () => {
    baseHandlers({
      datasets: async () => {
        await delay("infinite");
        return HttpResponse.json({ datasets: [], total: 12 });
      },
      quality: async () => {
        await delay("infinite");
        return HttpResponse.json(QUALITY_SUMMARY);
      },
      monitoringBuilds: async () => {
        await delay("infinite");
        return HttpResponse.json(MONITORING_BUILDS);
      },
      monitoringSummary: async () => {
        await delay("infinite");
        return HttpResponse.json(MONITORING_SUMMARY);
      },
    });
    renderHome();

    expect(await screen.findByText("r1")).toBeInTheDocument();
  });

  it("빌드가 없어도 기존 사용자의 aggregate KPI는 정상 표시한다", async () => {
    baseHandlers({
      builds: () => HttpResponse.json({ builds: [] }),
      datasets: () => HttpResponse.json({ datasets: [], total: 3 }),
    });
    renderHome();

    expect(await screen.findByText("작업 현황을 한눈에 확인하세요")).toBeInTheDocument();
    expect(await within(kpiCard("DATASETS")).findByText("3")).toBeInTheDocument();
    expect(await within(kpiCard("SUCCEEDED (24H)")).findByText("9")).toBeInTheDocument();
    expect(await within(kpiCard("QUALITY WARN (24H)")).findByText("4")).toBeInTheDocument();
  });

  it("빌드 목록 실패도 Recent Builds만 에러로 만들고 healthy KPI는 유지한다", async () => {
    baseHandlers({ builds: () => HttpResponse.json({ error: "down" }, { status: 500 }) });
    renderHome();

    expect(
      await screen.findByText("빌드 목록을 불러올 수 없습니다", undefined),
    ).toBeInTheDocument();
    expect(await within(kpiCard("DATASETS")).findByText("12")).toBeInTheDocument();
    expect(await within(kpiCard("SUCCEEDED (24H)")).findByText("9")).toBeInTheDocument();
    expect(await within(kpiCard("QUALITY WARN (24H)")).findByText("4")).toBeInTheDocument();
  });
});

describe("HomePage 최근 품질 상태", () => {
  const warning = {
    source_key: "source-1",
    category: "completeness",
    rule: "missing_values",
    column: "value",
    status: "warn" as const,
    actual: 3,
    threshold: 0,
    affected_rows: 3,
    evaluated_rows: 10,
    detail: "Missing values 3건",
  };

  it("최근 Run의 실제 WARN/FAIL만 표시하고 24H KPI와 범위를 구분한다", async () => {
    baseHandlers({
      qualityDetail: (runId) => HttpResponse.json({
        run_id: runId,
        availability: "available",
        evaluated_checks: 1,
        quality_results: { "source-1": [warning] },
        schema_drift: {},
      }),
    });
    renderHome();

    expect(await screen.findByText("최근 품질 상태")).toBeInTheDocument();
    expect(await screen.findByText("Missing values 3건")).toBeInTheDocument();
    expect(screen.getByText("WARN")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Quality Center 보기" })).toHaveAttribute("href", "/quality");
  });

  it("확인 가능한 결과에 WARN/FAIL이 없으면 빈 상태를 정직하게 표시한다", async () => {
    baseHandlers();
    renderHome();

    expect(
      await screen.findByText("최근 확인한 Build에서 품질 경고가 없습니다"),
    ).toBeInTheDocument();
  });

  it("detail unavailable을 0건이나 PASS로 위장하지 않는다", async () => {
    baseHandlers({
      qualityDetail: (runId) => HttpResponse.json({
        run_id: runId,
        availability: "unavailable",
        evaluated_checks: 0,
        quality_results: {},
        schema_drift: {},
      }),
    });
    renderHome();

    expect(await screen.findByText("일부 품질 정보를 확인할 수 없습니다")).toBeInTheDocument();
    expect(screen.queryByText("최근 확인한 Build에서 품질 경고가 없습니다")).not.toBeInTheDocument();
  });

  it("succeeded가 아닌 Run(failed/cancelled)에는 getBuildQuality를 호출하지 않는다", async () => {
    const detailRuns: string[] = [];
    baseHandlers({
      builds: () => HttpResponse.json({
        builds: [
          { run_id: "ok-1", status: "ok", started_at: "2026-09-01T05:00:00+00:00", finished_at: "2026-09-01T05:05:00+00:00" },
          { run_id: "failed-1", status: "failed", started_at: "2026-09-01T04:00:00+00:00", finished_at: "2026-09-01T04:05:00+00:00" },
          { run_id: "cancelled-1", status: "cancelled", started_at: "2026-09-01T03:00:00+00:00", finished_at: "2026-09-01T03:05:00+00:00" },
        ],
      }),
      qualityDetail: (runId) => {
        detailRuns.push(runId);
        return HttpResponse.json({
          run_id: runId,
          availability: "available",
          evaluated_checks: 1,
          quality_results: { "source-1": [warning] },
          schema_drift: {},
        });
      },
    });
    renderHome();

    expect(await screen.findByText("Missing values 3건")).toBeInTheDocument();
    expect(detailRuns).toEqual(["ok-1"]);
  });

  it("WARN/FAIL 항목은 해당 Run의 context(/builds/:runId)로 이동하는 링크다", async () => {
    baseHandlers({
      builds: () => HttpResponse.json({
        builds: [
          { run_id: "run-warn", status: "ok", started_at: "2026-09-01T05:00:00+00:00", finished_at: "2026-09-01T05:05:00+00:00" },
        ],
      }),
      qualityDetail: (runId) => HttpResponse.json({
        run_id: runId,
        availability: "available",
        evaluated_checks: 1,
        quality_results: { "source-1": [warning] },
        schema_drift: {},
      }),
    });
    renderHome();

    const alert = await screen.findByText("Missing values 3건");
    const link = alert.closest("a");
    expect(link).toHaveAttribute("href", "/builds/run-warn");
  });

  it("최근 Build가 6개여도 detail은 최대 5개만 병렬 조회한다", async () => {
    const detailRuns: string[] = [];
    baseHandlers({
      builds: () => HttpResponse.json({
        builds: Array.from({ length: 6 }, (_, index) => ({
          run_id: `r${index}`,
          status: "ok",
          started_at: `2026-09-01T0${index}:00:00+00:00`,
          finished_at: `2026-09-01T0${index}:05:00+00:00`,
        })),
      }),
      qualityDetail: (runId) => {
        detailRuns.push(runId);
        return HttpResponse.json({
          run_id: runId,
          availability: "available",
          evaluated_checks: 0,
          quality_results: {},
          schema_drift: {},
        });
      },
    });
    renderHome();

    await screen.findByText("최근 확인한 Build에서 품질 경고가 없습니다");
    expect(detailRuns).toHaveLength(5);
    expect(detailRuns).not.toContain("r0");
  });
});

/**
 * New user determination: empty build list alone is insufficient. In real mode, confirm as new
 * user only when authoritative `total` from Builder GET /datasets is verified as 0.
 * If total cannot be verified (old Builder / 404·5xx), show existing dashboard.
 */
describe("HomePage 신규 사용자 판정", () => {
  const NEW_USER_HEADING = "공공데이터를 찾아 신뢰할 수 있는 데이터셋으로 만드세요";
  const DASHBOARD_HEADING = "작업 현황을 한눈에 확인하세요";

  it("dataset total > 0이고 빌드가 없으면 신규 사용자가 아니다(기존 대시보드)", async () => {
    baseHandlers({
      builds: () => HttpResponse.json({ builds: [] }),
      datasets: () => HttpResponse.json({ datasets: [], total: 3 }),
    });
    renderHome();

    expect(await screen.findByText(DASHBOARD_HEADING)).toBeInTheDocument();
    expect(await within(kpiCard("DATASETS")).findByText("3")).toBeInTheDocument();
    expect(screen.queryByText(NEW_USER_HEADING)).not.toBeInTheDocument();
  });

  it("dataset total = 0이고 빌드가 없으면 신규 사용자 화면을 보여준다", async () => {
    baseHandlers({
      builds: () => HttpResponse.json({ builds: [] }),
      datasets: () => HttpResponse.json({ datasets: [], total: 0 }),
    });
    renderHome();

    expect(await screen.findByText(NEW_USER_HEADING)).toBeInTheDocument();
    expect(screen.queryByText(DASHBOARD_HEADING)).not.toBeInTheDocument();
  });

  it("dataset total이 없는 구버전 Builder에서는 빈 빌드만으로 신규 사용자로 오판하지 않는다", async () => {
    baseHandlers({
      builds: () => HttpResponse.json({ builds: [] }),
      datasets: () => HttpResponse.json({ datasets: [] }),
    });
    renderHome();

    expect(await screen.findByText(DASHBOARD_HEADING)).toBeInTheDocument();
    expect(await within(kpiCard("DATASETS")).findByText("확인 불가")).toBeInTheDocument();
    expect(screen.queryByText(NEW_USER_HEADING)).not.toBeInTheDocument();
  });

  it("dataset aggregate가 5xx로 실패해도 빈 빌드만으로 신규 사용자로 오판하지 않는다", async () => {
    baseHandlers({
      builds: () => HttpResponse.json({ builds: [] }),
      datasets: () => HttpResponse.json({ error: "boom" }, { status: 500 }),
    });
    renderHome();

    expect(await screen.findByText(DASHBOARD_HEADING)).toBeInTheDocument();
    expect(
      await within(kpiCard("DATASETS")).findByText("확인 불가", undefined),
    ).toBeInTheDocument();
    expect(screen.queryByText(NEW_USER_HEADING)).not.toBeInTheDocument();
  });
});

describe("HomePage 전체 작업 흐름 (설명형, 클릭 카드 아님)", () => {
  it("STEP 1~4를 설명형 워크플로로 보여준다", async () => {
    baseHandlers({
      builds: () => HttpResponse.json({ builds: [] }),
      datasets: () => HttpResponse.json({ datasets: [], total: 0 }),
    });
    renderHome();

    expect(await screen.findByText("전체 작업 흐름")).toBeInTheDocument();
    expect(screen.getByText("데이터 찾기")).toBeInTheDocument();
    expect(screen.getByText("Discover 또는 직접 데이터 추가")).toBeInTheDocument();
    expect(screen.getByText("가져오기 준비")).toBeInTheDocument();
    expect(screen.getByText("Public API는 인증·활용신청·요청값을 확인")).toBeInTheDocument();
    expect(screen.getByText("Preview · Build")).toBeInTheDocument();
    expect(screen.getByText("데이터를 미리 확인·검증한 뒤 Build")).toBeInTheDocument();
    expect(screen.getByText("품질 확인 · 활용")).toBeInTheDocument();
    expect(screen.getByText("Quality · Ask KPubData · Export · Publish")).toBeInTheDocument();

    // Not a clickable card — STEP card itself should not be link/button.
    expect(screen.queryByRole("link", { name: /데이터 찾기/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /데이터 찾기/ })).not.toBeInTheDocument();
  });
});
