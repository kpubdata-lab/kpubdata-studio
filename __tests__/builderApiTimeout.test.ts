/**
 * apiFetch 타임아웃/재시도 동작 테스트 (#94).
 *
 * Builder 응답 지연 시 UI가 무한 대기에 빠지지 않도록 자동 타임아웃이 걸리는지, 네트워크
 * 일시 장애와 5xx에 제한 재시도(지수 백오프)가 동작하는지, 호출자 취소는 즉시 전파되는지 검증한다.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, apiFetch, builderApi as api, setAuthTokenProvider } from "@/shared/lib/builderApi";

function okResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

function serverError(): Response {
  return {
    ok: false,
    status: 503,
    text: async () => JSON.stringify({ error: "unavailable" }),
  } as unknown as Response;
}

beforeEach(() => {
  setAuthTokenProvider(null);
});

afterEach(() => {
  setAuthTokenProvider(null);
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("apiFetch retry (#94)", () => {
  it("retries on a network error and then succeeds", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(okResponse({ service: "kpubdata-builder" }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await apiFetch<{ service: string }>("/version", { retries: 1, timeoutMs: 0 });

    expect(result.service).toBe("kpubdata-builder");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("retries on a 5xx response and then succeeds", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(serverError())
      .mockResolvedValueOnce(okResponse({ service: "ok" }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await apiFetch<{ service: string }>("/version", { retries: 1, timeoutMs: 0 });

    expect(result.service).toBe("ok");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not retry on a 4xx response", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      text: async () => JSON.stringify({ error: "bad spec" }),
    } as unknown as Response);
    vi.stubGlobal("fetch", fetchMock);

    await expect(apiFetch("/validate", { retries: 2, timeoutMs: 0 })).rejects.toMatchObject({
      status: 400,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("gives up after exhausting retries on persistent network failure", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("offline"));
    vi.stubGlobal("fetch", fetchMock);

    const error = await apiFetch("/version", { retries: 1, timeoutMs: 0 }).catch((cause) => cause);

    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(0);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("throws a 408 ApiError when the request times out with no retries left", async () => {
    // fetch가 결합된 timeout signal에서 abort되면 TimeoutError로 거부한다.
    const fetchMock = vi.fn().mockImplementation((_url, init: RequestInit) => {
      return new Promise((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const error = await apiFetch("/build", { method: "POST", timeoutMs: 5, retries: 0 }).catch(
      (cause) => cause,
    );

    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(408);
  });

  it("propagates caller cancellation without retrying", async () => {
    const controller = new AbortController();
    const fetchMock = vi.fn().mockImplementation((_url, init: RequestInit) => {
      return new Promise((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const promise = apiFetch("/version", { signal: controller.signal, retries: 2, timeoutMs: 0 });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    controller.abort(new DOMException("Aborted", "AbortError"));

    await expect(promise).rejects.toMatchObject({ name: "AbortError" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("the synchronous /build is not timed out (#723)", () => {
  it("succeeds with a response that takes longer than the default timeout", async () => {
    vi.useFakeTimers();
    const body = {
      status: "ok",
      run_id: "r1",
      manifest: "/runs/r1/manifest.json",
      api_version: "1.76.0",
      outcomes: [],
      composition: null,
    };
    const fetchMock = vi.fn().mockImplementation((_url, init: RequestInit) => {
      return new Promise((resolve, reject) => {
        init.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
        setTimeout(() => resolve(okResponse(body)), 95_000);
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const pending = api.build("dataset_id: x", "r1");
    await vi.advanceTimersByTimeAsync(95_000);

    await expect(pending).resolves.toMatchObject({ status: "ok", run_id: "r1" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    // No timeout signal is attached: only a caller's own signal could abort the request.
    expect(fetchMock.mock.calls[0][1].signal).toBeUndefined();
  });

  it("is still cancelled by the caller's signal", async () => {
    const controller = new AbortController();
    const fetchMock = vi.fn().mockImplementation((_url, init: RequestInit) => {
      return new Promise((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const pending = api.build("dataset_id: x", "r1", controller.signal).catch((cause) => cause);
    // The request is sent after the auth token is awaited; cancel once it is in flight.
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    controller.abort();

    expect(await pending).toBeInstanceOf(DOMException);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("/preview is not retried (#724)", () => {
  it("sends one request when Builder answers 5xx", async () => {
    const fetchMock = vi.fn().mockResolvedValue(serverError());
    vi.stubGlobal("fetch", fetchMock);

    const error = await api.preview("dataset_id: x").catch((cause) => cause);

    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(503);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("sends one request when the connection fails", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("offline"));
    vi.stubGlobal("fetch", fetchMock);

    const error = await api.preview("dataset_id: x").catch((cause) => cause);

    expect((error as ApiError).status).toBe(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("leaves /validate, which carries no key, retried as before", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockResolvedValue(serverError());
    vi.stubGlobal("fetch", fetchMock);

    const pending = api.validate("dataset_id: x").catch((cause) => cause);
    await vi.advanceTimersByTimeAsync(10_000);

    expect(await pending).toBeInstanceOf(ApiError);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
