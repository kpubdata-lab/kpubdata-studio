/**
 * MSW (Mock Service Worker) 핸들러 — Builder API HTTP 모의 응답 (#104)
 *
 * 실제 Builder API와 동일한 와이어 형태로 응답하여,
 * vitest 환경에서 실제 HTTP 요청을 통한 E2E 테스트를 가능하게 한다.
 *
 * 참고: src/shared/lib/builderApi.ts의 응답 타입과 정합하도록 작성할 것.
 */

import { http, HttpResponse } from "msw";
import { API_BASE } from "@/shared/config/env";
import { MIN_BUILDER_API_VERSION } from "@/shared/lib/builderApi";

/**
 * The one `api_version` every shared mock answers with (#993). It follows Studio's
 * contract floor, so a mock can never claim a Builder Studio would refuse. A test that
 * needs an older or otherwise incompatible Builder overrides the route itself with
 * `server.use()` and names that version in the test.
 */
export const MOCK_BUILDER_API_VERSION = MIN_BUILDER_API_VERSION;

/**
 * 비동기 build job 모의 상태 시퀀스 (#245, builder #480/#482).
 *
 * POST /builds 제출 직후 queued로 시작해 GET /builds/{run_id} 폴링마다
 * queued → running → terminal(succeeded/failed)로 진행한다. 실패 시나리오는
 * spec에 `dataset_id: fail_source`가 포함된 경우로 판별한다(동기 /build 모의와
 * 동일한 규칙).
 */
const asyncJobStates = new Map<
  string,
  { pollCount: number; failed: boolean; cancelled?: boolean; cancelPollCount?: number }
>();

const ASYNC_JOB_TIMELINE = ["queued", "running"] as const;

export const handlers = [
  /**
   * GET /version — Builder API 계약 버전 확인
   */
  http.get(`${API_BASE}/version`, () => {
    return HttpResponse.json({
      service: "kpubdata-builder",
      api_version: MOCK_BUILDER_API_VERSION,
    });
  }),

  http.get(`${API_BASE}/catalog`, () => {
    return HttpResponse.json({
      providers: [
        {
          name: "datago",
          datasets: [
            {
              name: "air_quality",
              title: "대기오염",
              description: null,
              tags: [],
              source_url: null,
              representation: "api_json",
              operations: [],
              query_support: null,
              requires_service_key: true,
            },
          ],
        },
      ],
    });
  }),

  /**
   * POST /validate — BuildSpec YAML 검증 (동기식)
   */
  http.post(`${API_BASE}/validate`, async ({ request }) => {
    const body = await request.json();
    const spec = typeof body === "object" && body && "spec" in body ? (body as { spec: string }).spec : "";

    // 유효한 스펙 예시
    if (spec.includes("dataset_id: weather_report") && spec.includes("region:")) {
      return HttpResponse.json({
        status: "valid" as const,
        dataset_id: "weather_report",
        api_version: MOCK_BUILDER_API_VERSION,
      });
    }

    // 필수 파라미터 누락 (검증 실패) — sources가 있지만 region이 없는 경우
    if (spec.includes("sources:") && spec.includes("region:") === false) {
      return HttpResponse.json(
        {
          status: "invalid" as const,
          problems: ["'region' 파라미터가 누락되었습니다."],
        },
        { status: 400 },
      );
    }

    // 스펙 로딩 오류
    if (spec.includes("invalid_yaml")) {
      return HttpResponse.json(
        {
          status: "error" as const,
          error: "top-level YAML must be a mapping",
        },
        { status: 400 },
      );
    }

    // 기본 응답
    return HttpResponse.json({
      status: "valid" as const,
      dataset_id: "test_dataset",
      api_version: MOCK_BUILDER_API_VERSION,
    });
  }),

  /**
   * POST /builds — 비동기 build job 제출 (#245, builder #480/#482)
   */
  http.post(`${API_BASE}/builds`, async ({ request }) => {
    const body = await request.json();
    const spec = typeof body === "object" && body && "spec" in body ? (body as { spec: string }).spec : "";
    const runId =
      typeof body === "object" && body && "run_id" in body
        ? String((body as { run_id?: string }).run_id)
        : `run_async_${Date.now()}`;
    // spec은 원시 YAML(e2e) 또는 JSON 직렬화(executeBuild→serializeSpec) 둘 다 올 수
    // 있으므로 두 형태 모두 판별한다.
    const failed =
      spec.includes("dataset_id: fail_source") || spec.includes('"dataset_id":"fail_source"');
    asyncJobStates.set(runId, { pollCount: 0, failed });
    return HttpResponse.json(
      {
        run_id: runId,
        status: "queued",
        created_at: "2026-08-16T09:00:00+00:00",
        updated_at: "2026-08-16T09:00:00+00:00",
      },
      { status: 202 },
    );
  }),

  /**
   * GET /builds/{run_id} — 비동기 build job 상태 polling (#245)
   */
  http.get<{ run_id: string }>(`${API_BASE}/builds/:run_id`, ({ params }) => {
    const runId = params.run_id as string;
    const state = asyncJobStates.get(runId);
    if (!state) {
      return HttpResponse.json({ error: `build job not found: ${runId}` }, { status: 404 });
    }
    // 협조적 취소 관찰 시퀀스: POST /builds/{run_id}/cancel 이후 첫 폴링은 cancelling,
    // 그다음부터 cancelled terminal(builder #481).
    if (state.cancelled) {
      state.cancelPollCount = (state.cancelPollCount ?? 0) + 1;
      return HttpResponse.json({
        run_id: runId,
        status: state.cancelPollCount >= 2 ? "cancelled" : "cancelling",
        created_at: "2026-08-16T09:00:00+00:00",
        updated_at: "2026-08-16T09:00:05+00:00",
      });
    }
    state.pollCount += 1;
    const timelineIndex = Math.min(state.pollCount - 1, ASYNC_JOB_TIMELINE.length - 1);
    const failed = state.failed;
    // 마지막 timeline 상태(running)보다 더 폴링되면 terminal로 종결한다.
    if (state.pollCount > ASYNC_JOB_TIMELINE.length) {
      const base = {
        run_id: runId,
        status: failed ? "failed" : "succeeded",
        created_at: "2026-08-16T09:00:00+00:00",
        updated_at: "2026-08-16T09:00:07+00:00",
      };
      if (failed) {
        return HttpResponse.json({ ...base, error: "upstream API timeout" });
      }
      return HttpResponse.json({
        ...base,
        response: {
          status: "ok",
          run_id: runId,
          outcomes: [],
          manifest: `output/${runId}/manifest.json`,
          api_version: MOCK_BUILDER_API_VERSION,
        },
      });
    }
    return HttpResponse.json({
      run_id: runId,
      status: ASYNC_JOB_TIMELINE[timelineIndex],
      created_at: "2026-08-16T09:00:00+00:00",
      updated_at: "2026-08-16T09:00:01+00:00",
    });
  }),

  /**
   * POST /builds/{run_id}/cancel — 협조적 취소 요청 (#245, builder #481).
   * 등록된 job이면 취소 시퀀스를 켜고 최신 스냅샷(cancelling)을 돌려준다.
   */
  http.post<{ run_id: string }>(`${API_BASE}/builds/:run_id/cancel`, ({ params }) => {
    const runId = params.run_id as string;
    const state = asyncJobStates.get(runId);
    if (!state) {
      return HttpResponse.json({ error: `build job not found: ${runId}` }, { status: 404 });
    }
    state.cancelled = true;
    return HttpResponse.json({
      run_id: runId,
      status: "cancelling",
      created_at: "2026-08-16T09:00:00+00:00",
      updated_at: "2026-08-16T09:00:04+00:00",
    });
  }),

  /**
   * POST /build — 빌드 파이프라인 실행 (동기식)
   */
  http.post(`${API_BASE}/build`, async ({ request }) => {
    const body = await request.json();
    const spec = typeof body === "object" && body && "spec" in body ? (body as { spec: string }).spec : "";

    // 정상 빌드 응답
    if (spec.includes("dataset_id: success")) {
      return HttpResponse.json({
        status: "ok" as const,
        run_id: "run_123",
        outcomes: [
          {
            source_key: "kma__forecast",
            status: "ok" as const,
            stages_completed: ["bronze", "silver"],
            error: null,
          },
        ],
        manifest: "output/run_123/manifest.json",
        api_version: MOCK_BUILDER_API_VERSION,
      });
    }

    // 소스 실패 응답 (502)
    if (spec.includes("dataset_id: fail_source")) {
      return HttpResponse.json(
        {
          status: "failed" as const,
          run_id: "run_456",
          outcomes: [
            {
              source_key: "datago__corporation",
              status: "failed" as const,
              stages_completed: [],
              error: "upstream API timeout",
            },
          ],
          manifest: "output/run_456/manifest.json",
          api_version: MOCK_BUILDER_API_VERSION,
        },
        { status: 502 },
      );
    }

    // 기본 응답
    return HttpResponse.json({
      status: "ok" as const,
      run_id: "run_default",
      outcomes: [],
      manifest: "output/run_default/manifest.json",
      api_version: MOCK_BUILDER_API_VERSION,
    });
  }),

  /**
   * GET /artifacts/{run_id} — 실행 산출물 파일 목록
   */
  http.get<{ run_id: string }>(`${API_BASE}/artifacts/:run_id`, ({ params }) => {
    const { run_id } = params;
    return HttpResponse.json({
      run_id,
      files: ["manifest.json", "weather_report.md", "weather_report.parquet"],
    });
  }),

  /** Builder PR #547 publish readiness fixture. */
  http.get<{ run_id: string }>(`${API_BASE}/builds/:run_id/publish/readiness`, ({ params }) =>
    HttpResponse.json({
      run_id: params.run_id,
      target: "huggingface" as const,
      ready: true,
      blockers: [],
      warnings: [],
    }),
  ),

  /** Builder PR #547 publish response fixture — request의 exact Run/destination을 보존한다. */
  http.post<{ run_id: string }>(`${API_BASE}/builds/:run_id/publish`, async ({ params, request }) => {
    const body = await request.json() as { destination: string };
    return HttpResponse.json({
      run_id: params.run_id,
      target: "huggingface" as const,
      publisher: "huggingface",
      destination: body.destination,
      reference: `https://huggingface.co/datasets/${body.destination}`,
      artifact_count: 1,
      status: "ok",
    });
  }),

  /**
   * POST /preview — 소스 스키마와 샘플 행 산출 (파일 미기록). #497로 statistics/
   * quality_results/diff 필드가 필수가 됐다.
   */
  http.post(`${API_BASE}/preview`, async () => {
    const sample = [
      { date: "2024-04-01", temp: 15.5 },
      { date: "2024-04-02", temp: 16.0 },
    ];
    return HttpResponse.json({
      dataset_id: "weather_report",
      previews: [
        {
          source_key: "kma__forecast",
          status: "ok" as const,
          error: null,
          schema: [
            { name: "date", dtype: "Utf8", nullable: false, unique_count: 30 },
            { name: "temp", dtype: "Float64", nullable: true, unique_count: 25 },
          ],
          sample,
          total_rows: 30,
          statistics: { row_count: 30, null_counts: { date: 0, temp: 1 }, duplicate_rate: 0 },
          quality_results: [],
          source_sample: sample,
          sample_mode: "first" as const,
          diff_available: false,
          diffs: [],
          transform_summary: null,
          diff_truncated: false,
        },
      ],
    });
  }),
];

/**
 * 특수 시나리오 핸들러 (timeout, 5xx retry, network error 등)
 * 일반 핸들러보다 나중에 추가하여 우선순위를 가짐.
 */
export const scenarioHandlers = {
  /**
   * Timeout 시나리오 — 응답이 늦게 도착하도록 지연
   */
  timeout: http.get(`${API_BASE}/timeout`, () => {
    // 40초 지연 (builderApi.ts의 DEFAULT_TIMEOUT_MS=30000ms 초과)
    return new Promise((resolve) => {
      setTimeout(() => {
        resolve(HttpResponse.json({ service: "kpubdata-builder", api_version: MOCK_BUILDER_API_VERSION }));
      }, 40000);
    });
  }),

  /**
   * 5xx 서버 오류 시나리오 — 재시도 후 최종 실패
   */
  serverError: http.get(`${API_BASE}/server-error`, () => {
    return HttpResponse.json({ error: "Internal server error" }, { status: 500 });
  }),

  /**
   * Network error 시나리오 — 연결 실패
   * (MSW로는 실제 네트워크 오류를 흉내 낼 수 없어, 응답을 받지 않는 핸들러를 등록하지 않음)
   * 테스트에서는 fetch 자체를 reject하는 mock을 사용해야 함.
   */
  networkError: null,
};
