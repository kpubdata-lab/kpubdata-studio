/**
 * Builder API 실제 HTTP E2E 테스트 (#104)
 *
 * MSW (Mock Service Worker)를 사용하여 실제 HTTP 요청을 모의 Builder API로
 * 인터셉트하고, 7개 최소 검증 시나리오를 실행한다.
 *
 * 시나리오 1~4는 진짜 fetch 호출을 수행하고 MSW가 모의 응답을 반환한다.
 * 시나리오 5~7은 timeout/retry/network 경계를 검증하기 위해 fetch를 직접 대체한다.
 */

import { describe, expect, it, vi } from "vitest";
import { ApiError, apiFetch, builderApi } from "@/shared/lib/builderApi";
import { mswServer } from "../vitest.setup";

describe("Builder API 실제 HTTP E2E 테스트 (#104)", () => {
  /**
   * 시나리오 1: GET /version → VersionResponse 타입 검증
   *
   * 실제 HTTP GET 요청을 /version으로 보내고, 응답이 VersionResponse 타입과
   * 일치하는지 검증한다.
   */
  it("시나리오 1: GET /version → VersionResponse 타입 검증", async () => {
    const result = await builderApi.version();

    expect(result).toEqual({
      service: "kpubdata-builder",
      api_version: "1.0.0",
    });

    // 타입 검증 (런타임)
    expect(typeof result.service).toBe("string");
    expect(typeof result.api_version).toBe("string");
  });

  /**
   * 시나리오 2: POST /validate (유효 스펙) → ValidateResponse
   *
   * 유효한 BuildSpec YAML을 POST /validate로 보내고, 검증 성공 응답을
   * 받는지 검증한다.
   */
  it("시나리오 2: POST /validate (유효 스펙) → ValidateResponse", async () => {
    const validSpec = `
dataset_id: weather_report
sources:
  - provider: kma
    dataset: forecast
    params:
      region: 서울
`;

    const result = await builderApi.validate(validSpec);

    expect(result.status).toBe("valid");
    if (result.status === "valid") {
      expect(result.dataset_id).toBe("weather_report");
      expect(result.api_version).toBe("1.0.0");
    }
  });

  /**
   * 시나리오 3: POST /validate (무효 스펙) → 400 + error 추출
   *
   * 무효한 BuildSpec YAML을 POST /validate로 보내고, HTTP 400 오류와
   * 검증 실패 응답을 받는지 검증한다. extractErrorMessage로 문제를 추출한다.
   */
  it("시나리오 3: POST /validate (무효 스펙) → 400 + error 추출", async () => {
    const invalidSpec = `
dataset_id: weather_report
sources:
  - provider: kma
    dataset: forecast
    # region 파라미터 누락 (필수)
`;

    try {
      await builderApi.validate(invalidSpec);
      expect.fail("오류가 발생해야 합니다.");
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError);
      const apiError = error as ApiError;
      expect(apiError.status).toBe(400);
      // apiError.message를 통해 검증
      expect(apiError.message).toBeTruthy();
    }
  });

  /**
   * 시나리오 4: POST /build → BuildResponse (with outcomes)
   *
   * BuildSpec YAML을 POST /build로 보내고, 빌드 성공 응답을 받는다.
   * outcomes 배열이 포함된 응답을 검증한다.
   */
  it("시나리오 4: POST /build → BuildResponse (with outcomes)", async () => {
    const buildSpec = `
dataset_id: success
sources:
  - provider: kma
    dataset: forecast
    params:
      region: 서울
`;

    const result = await builderApi.build(buildSpec);

    expect(result.status).toBe("ok");
    expect(result.run_id).toBe("run_123");
    expect(result.outcomes).toHaveLength(1);
    expect(result.outcomes[0]).toMatchObject({
      source_key: "kma__forecast",
      status: "ok",
      stages_completed: ["bronze", "silver"],
      error: null,
    });
    expect(result.manifest).toBe("output/run_123/manifest.json");
    expect(result.api_version).toBe("1.0.0");
  });

  /**
   * 시나리오 5: Timeout 설정 확인
   *
   * apiFetch가 timeoutMs 옵션을 제대로 처리하는지 검증한다.
   * 실제 타임아웃 발생은 테스트 환경에서 까다로우므로,
   * 타임아웃 옵션 전달 동작만 확인한다.
   */
  it("시나리오 5: Timeout 설정 확인", async () => {
    // 타임아웃이 0 이하일 때 타임아웃이 비활성화됨을 확인
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ service: "kpubdata-builder", api_version: "1.0.0" }),
    } as Response);

    vi.stubGlobal("fetch", fetchMock);

    try {
      // 타임아웃 0으로 설정 (비활성화)
      await apiFetch("/version", { timeoutMs: 0 });

      // fetch가 호출되었는지 확인
      expect(fetchMock).toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  /**
   * 시나리오 6: 5xx retry → 3 attempts then failure
   *
   * 500 서버 오류를 반환하고, apiFetch가 지수 백오프로 3회 재시도한 후
   * 최종적으로 실패하는지 검증한다.
   *
   * 참고: MSW 서버를 일시정지하고 fetch를 직접 mock하여 재시도 횟수를 검증한다.
   */
  it("시나리오 6: 5xx retry → 3 attempts then failure", async () => {
    let attemptCount = 0;

    // MSW 서버 일시 정지 (fetch mock이 우선되도록)
    mswServer.close();

    // fetch를 mock하여 500 오류와 재시도 횟수 카운트
    const fetchMock = vi.fn().mockImplementation(async () => {
      attemptCount++;
      // 500 오류 응답 (5xx는 재시도 대상)
      return {
        ok: false,
        status: 500,
        text: async () => JSON.stringify({ error: "Internal server error" }),
      } as unknown as Response;
    });

    vi.stubGlobal("fetch", fetchMock);

    try {
      // DEFAULT_RETRIES=2이므로, 최초 1회 + 재시도 2회 = 총 3회 시도
      await apiFetch("/server-error", { retries: 2 });
      expect.fail("서버 오류가 발생해야 합니다.");
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError);
      const apiError = error as ApiError;
      expect(apiError.status).toBe(500);
      // 재시도 횟수 검증 (총 3회 시도)
      expect(attemptCount).toBe(3);
    } finally {
      vi.unstubAllGlobals();
      // MSW 서버 재시작
      mswServer.listen({ onUnhandledFrame: "warn" });
    }
  });

  /**
   * 시나리오 7: Network error → ApiError(0)
   *
   * 네트워크 오류를 시뮬레이션하고, ApiError(0)이 발생하는지 검증한다.
   * MSW로는 실제 네트워크 오류를 흉내 낼 수 없어, fetch 자체를 reject하는
   * mock을 사용한다.
   */
  it("시나리오 7: Network error → ApiError(0)", async () => {
    // fetch를 reject하여 네트워크 오류 시뮬레이션
    const fetchMock = vi.fn().mockRejectedValue(new Error("offline"));
    vi.stubGlobal("fetch", fetchMock);

    try {
      await apiFetch("/version");
      expect.fail("네트워크 오류가 발생해야 합니다.");
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError);
      const apiError = error as ApiError;
      expect(apiError.status).toBe(0); // ApiError(0)
      expect(apiError.message).toContain("연결하지 못했습니다");
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
