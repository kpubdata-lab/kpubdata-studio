import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { executeBuild } from "@/features/runs/api";
import { useBuildJob } from "@/features/runs/useBuildJob";
import type { BuildSpec } from "@/shared/lib/types";

const spec: BuildSpec = {
  datasetId: "x",
  title: "t",
  description: "d",
  sources: [{ provider: "datago", dataset: "air", params: {} }],
  exports: [{ format: "jsonl" }],
  metadata: {},
};

function mockResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("executeBuild (#39)", () => {
  it("returns a mock succeeded run without network in mock mode", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const run = await executeBuild(spec);
    expect(run.status).toBe("succeeded");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("submits an async job and polls it to a succeeded run in real mode (#245)", async () => {
    vi.stubEnv("VITE_USE_REAL_BUILDER", "true");
    let pollCount = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith("/builds")) {
          return mockResponse(202, {
            run_id: "run42",
            status: "queued",
            created_at: "2026-08-16T09:00:00+00:00",
            updated_at: "2026-08-16T09:00:00+00:00",
          });
        }
        pollCount += 1;
        if (pollCount === 1) {
          return mockResponse(200, {
            run_id: "run42",
            status: "running",
            created_at: "2026-08-16T09:00:00+00:00",
            updated_at: "2026-08-16T09:00:01+00:00",
          });
        }
        return mockResponse(200, {
          run_id: "run42",
          status: "succeeded",
          created_at: "2026-08-16T09:00:00+00:00",
          updated_at: "2026-08-16T09:00:07+00:00",
          response: {
            status: "ok",
            run_id: "run42",
            outcomes: [],
            manifest: "m",
            api_version: "1.16.0",
          },
        });
      }),
    );
    const run = await executeBuild(spec);
    expect(run.id).toBe("run42");
    expect(run.status).toBe("succeeded");
    // 실연동 모드는 1970 고정값이 아니라 실제 실행 시각을 기록한다.
    expect(run.startedAt).not.toBe("1970-01-01T00:00:00.000Z");
  });
});

describe("useBuildJob (#39)", () => {
  it("transitions idle → running → succeeded", async () => {
    const { result } = renderHook(() => useBuildJob());
    expect(result.current.status).toBe("idle");

    await act(async () => {
      await result.current.start(spec);
    });

    expect(result.current.status).toBe("succeeded");
    expect(result.current.run?.id).toBe("mock-run");
  });

  it("surfaces the derived failure summary on a partial build (#75, #245)", async () => {
    vi.stubEnv("VITE_USE_REAL_BUILDER", "true");
    // 성공한 잡의 최종 build 응답이 부분 실패인 wire — Builder는 첫 실패 outcome에서
    // 파생한 최상위 error 요약을 항상 실는다(contract BuildFailureResponse).
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith("/builds")) {
          return mockResponse(202, {
            run_id: "run-fail",
            status: "queued",
            created_at: "2026-08-16T09:00:00+00:00",
            updated_at: "2026-08-16T09:00:00+00:00",
          });
        }
        return mockResponse(200, {
          run_id: "run-fail",
          status: "succeeded",
          created_at: "2026-08-16T09:00:00+00:00",
          updated_at: "2026-08-16T09:00:07+00:00",
          response: {
            status: "failed",
            run_id: "run-fail",
            manifest: "",
            api_version: "1.16.0",
            error: "upstream source failed",
            outcomes: [
              {
                source_key: "datago:air",
                status: "failed",
                stages_completed: [],
                error: "upstream source failed",
              },
            ],
          },
        });
      }),
    );

    const { result } = renderHook(() => useBuildJob());
    await act(async () => {
      await result.current.start(spec);
    });

    expect(result.current.status).toBe("failed");
    expect(result.current.error).toBe("upstream source failed");
  });

  it("aborts an in-flight build on unmount (#73)", async () => {
    // executeBuild를 영원히 보류되는(pending) 호출로 대체하고, 전달된 AbortSignal을 캡처한다.
    let capturedSignal: AbortSignal | undefined;
    const executeBuildMock = vi
      .spyOn(await import("@/features/runs/api"), "executeBuild")
      .mockImplementation(
        (_spec, signal) =>
          new Promise(() => {
            capturedSignal = signal;
          }),
      );

    const { result, unmount } = renderHook(() => useBuildJob());
    act(() => {
      void result.current.start(spec);
    });

    expect(capturedSignal?.aborted).toBe(false);

    unmount();

    expect(capturedSignal?.aborted).toBe(true);
    executeBuildMock.mockRestore();
  });

  it("start()를 즉시 2회 호출해도 executeBuild는 1회만 호출된다(controllerRef guard, #283 9-G)", async () => {
    let callCount = 0;
    let resolveExecute: ((run: import("@/shared/lib/types").BuildRun) => void) | undefined;
    const executeBuildMock = vi
      .spyOn(await import("@/features/runs/api"), "executeBuild")
      .mockImplementation(
        () =>
          new Promise((resolve) => {
            callCount += 1;
            resolveExecute = resolve;
          }),
      );

    const { result } = renderHook(() => useBuildJob());

    // start를 연달아 2회 호출 — 두 번째 호출은 controllerRef.current가 이미 세팅돼
    // 있으므로 즉시 no-op으로 반환해야 한다(실제 executeBuild/POST /builds 호출은 1회).
    act(() => {
      void result.current.start(spec);
      void result.current.start(spec);
    });

    expect(callCount).toBe(1);

    await act(async () => {
      resolveExecute?.({
        id: "mock-run",
        spec,
        status: "succeeded",
        startedAt: "1970-01-01T00:00:00.000Z",
        finishedAt: "1970-01-01T00:00:00.000Z",
      });
    });

    expect(result.current.status).toBe("succeeded");
    executeBuildMock.mockRestore();
  });
});

describe("a build refused for a missing provider key (#787)", () => {
  it("says which keys, and forgets it when the build is started again", async () => {
    const { ApiError } = await import("@/shared/lib/builderApi");
    const refused = new ApiError(400, "this build calls datago, and the request carries no key for it", {
      error: "this build calls datago, and the request carries no key for it",
      code: "provider_credential_required",
      providers: ["datago"],
    });
    const executeBuildMock = vi
      .spyOn(await import("@/features/runs/api"), "executeBuild")
      .mockRejectedValueOnce(refused)
      .mockResolvedValueOnce({ id: "run-2", spec, status: "succeeded", startedAt: "s", finishedAt: "f" });
    const { result } = renderHook(() => useBuildJob());

    await act(async () => {
      await result.current.start(spec);
    });

    expect(result.current.status).toBe("failed");
    expect(result.current.missingKeys).toEqual({ providers: ["datago"], keptIn: "request" });
    // Nothing was submitted, so there is no run to retry.
    expect(result.current.run).toBeUndefined();

    await act(async () => {
      await result.current.start(spec);
    });

    expect(result.current.status).toBe("succeeded");
    expect(result.current.missingKeys).toBeUndefined();
    expect(executeBuildMock).toHaveBeenCalledTimes(2);
    executeBuildMock.mockRestore();
  });

  it("an ordinary failure names no keys", async () => {
    const { ApiError } = await import("@/shared/lib/builderApi");
    const executeBuildMock = vi
      .spyOn(await import("@/features/runs/api"), "executeBuild")
      .mockRejectedValueOnce(new ApiError(502, "provider client unavailable", { error: "provider client unavailable" }));
    const { result } = renderHook(() => useBuildJob());

    await act(async () => {
      await result.current.start(spec);
    });

    expect(result.current.status).toBe("failed");
    expect(result.current.missingKeys).toBeUndefined();
    executeBuildMock.mockRestore();
  });
});
