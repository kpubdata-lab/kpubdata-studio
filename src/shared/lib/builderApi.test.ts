/**
 * builderApi retry policy test (#117).
 *
 * Non-idempotent POST /build must not retry on 5xx; idempotent GET does retry.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { API_BASE } from "@/shared/config/env";
import {
  ApiError,
  ContractMismatchError,
  DEFAULT_TIMEOUT_MS,
  PROBE_TIMEOUT_MS,
  builderApi,
  resetAuthRenewalForTests,
  setAuthErrorCallback,
  setAuthTokenProvider,
} from "./builderApi";
import { clearSessionRefusal, isSessionRefused, useSessionRefusalStore } from "./sessionRefusal";

// A refusal recorded by one test would stop the next one's 401 from being renewed (#771).
beforeEach(() => {
  clearSessionRefusal();
  resetAuthRenewalForTests();
});

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("builderApi retry policy", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("does not retry POST /build on 5xx (#117)", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(jsonResponse(500, { error: "boom" }));

    await expect(builderApi.build("dataset_id: x")).rejects.toMatchObject({
      status: 500,
    });

    // should be called only once initially (no retry).
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("retries idempotent GET /version on 5xx", async () => {
    // advance time directly with fake timer to avoid actual backoff wait (500ms).
    vi.useFakeTimers();
    try {
      const fetchMock = vi
        .spyOn(globalThis, "fetch")
        .mockResolvedValueOnce(jsonResponse(500, { error: "temp" }))
        .mockResolvedValueOnce(
          jsonResponse(200, { service: "kpubdata-builder", api_version: "1.0.0" }),
        );

      const pending = builderApi.version();
      // immediately pass the backoff (500ms) before first retry.
      await vi.advanceTimersByTimeAsync(500);
      const result = await pending;

      expect(result.api_version).toBe("1.0.0");
      expect(fetchMock.mock.calls.length).toBeGreaterThan(1);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("apiFetch auth header injection (#186)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    setAuthTokenProvider(null);
  });

  afterEach(() => {
    setAuthTokenProvider(null);
    vi.restoreAllMocks();
  });

  function requestInitOf(fetchMock: ReturnType<typeof vi.spyOn>) {
    // fetch(url, init) — second argument is RequestInit.
    return fetchMock.mock.calls[0][1] as RequestInit;
  }

  it("does not send Authorization when no provider is set (회귀 없음)", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(jsonResponse(200, { service: "kpubdata-builder", api_version: "1.0.0" }));

    await builderApi.version();

    const headers = requestInitOf(fetchMock).headers as Record<string, string>;
    expect(headers.Authorization).toBeUndefined();
    // empty header should not be sent in unauthenticated/mock mode.
    expect(headers["Content-Type"]).toBe("application/json");
  });

  it("sends Authorization: Bearer <token> when provider returns a token", async () => {
    setAuthTokenProvider(() => "id-token-jwt");
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(jsonResponse(200, { service: "kpubdata-builder", api_version: "1.0.0" }));

    await builderApi.version();

    const headers = requestInitOf(fetchMock).headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer id-token-jwt");
  });

  it("does not send Authorization when provider returns null (미로그인)", async () => {
    setAuthTokenProvider(() => null);
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(jsonResponse(200, { service: "kpubdata-builder", api_version: "1.0.0" }));

    await builderApi.version();

    const headers = requestInitOf(fetchMock).headers as Record<string, string>;
    expect(headers.Authorization).toBeUndefined();
  });
});

describe("async auth token provider (OIDC refresh at request boundary)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    setAuthTokenProvider(null);
  });

  afterEach(() => {
    setAuthTokenProvider(null);
    vi.restoreAllMocks();
  });

  function requestInitOf(fetchMock: ReturnType<typeof vi.spyOn>) {
    return fetchMock.mock.calls[0][1] as RequestInit;
  }

  it("awaits a Promise-returning provider and uses the resolved (refreshed) token", async () => {
    setAuthTokenProvider(async () => "refreshed-access-token");
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(jsonResponse(200, { service: "kpubdata-builder", api_version: "1.0.0" }));

    await builderApi.version();

    const headers = requestInitOf(fetchMock).headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer refreshed-access-token");
  });

  it("sends no Authorization header when the async provider resolves null (refresh failed / mock mode)", async () => {
    setAuthTokenProvider(() => Promise.resolve(null));
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(jsonResponse(200, { service: "kpubdata-builder", api_version: "1.0.0" }));

    await builderApi.version();

    const headers = requestInitOf(fetchMock).headers as Record<string, string>;
    expect(headers.Authorization).toBeUndefined();
  });
});

describe("auth error callback on 401 (#189, S4)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    setAuthTokenProvider(null);
    setAuthErrorCallback(null);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    setAuthTokenProvider(null);
    setAuthErrorCallback(null);
  });

  it("calls auth error callback on 401", async () => {
    const cb = vi.fn();
    setAuthErrorCallback(cb);
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValue(jsonResponse(401, { error: "unauthorized" }));

    await expect(builderApi.version()).rejects.toMatchObject({ status: 401 });
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it("does not call auth error callback on 403", async () => {
    const cb = vi.fn();
    setAuthErrorCallback(cb);
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValue(jsonResponse(403, { error: "forbidden" }));

    await expect(builderApi.version()).rejects.toMatchObject({ status: 403 });
    expect(cb).not.toHaveBeenCalled();
  });

  it("retries the request once with the refreshed token when the callback recovers (#189)", async () => {
    // Token expires during request: first attempt gets 401, second attempt succeeds after re-auth.
    let token = "expired-token";
    setAuthTokenProvider(() => token);
    setAuthErrorCallback(() => {
      token = "fresh-token";
      return true;
    });
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jsonResponse(401, { error: "unauthorized" }))
      .mockResolvedValueOnce(
        jsonResponse(200, { service: "kpubdata-builder", api_version: "1.0.0" }),
      );

    const result = await builderApi.version();

    expect(result.api_version).toBe("1.0.0");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const retryHeaders = (fetchMock.mock.calls[1]![1] as RequestInit).headers as Record<string, string>;
    expect(retryHeaders.Authorization).toBe("Bearer fresh-token");
  });

  it("retries a recovered 401 only once and then surfaces the error", async () => {
    setAuthTokenProvider(() => "token");
    setAuthErrorCallback(() => true);
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(jsonResponse(401, { error: "unauthorized" }));

    await expect(builderApi.version()).rejects.toMatchObject({ status: 401 });
    // Even if re-auth keeps reporting "success", retry is limited to 1 (loop prevention).
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not retry when the callback does not report a recovered session", async () => {
    setAuthTokenProvider(() => "token");
    // Callbacks using old contract (void return) do not trigger retry.
    const cb = vi.fn();
    setAuthErrorCallback(cb);
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(jsonResponse(401, { error: "unauthorized" }));

    await expect(builderApi.version()).rejects.toMatchObject({ status: 401 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it("keeps the 401 when the recovery callback itself throws", async () => {
    setAuthTokenProvider(() => "token");
    setAuthErrorCallback(() => {
      throw new Error("refresh crashed");
    });
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(jsonResponse(401, { error: "unauthorized" }));

    await expect(builderApi.version()).rejects.toMatchObject({ status: 401 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("retries a 401 upload once — Builder rejects before the upload is stored (#189)", async () => {
    let token = "expired-token";
    setAuthTokenProvider(() => token);
    setAuthErrorCallback(() => {
      token = "fresh-token";
      return true;
    });
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jsonResponse(401, { error: "unauthorized" }))
      .mockResolvedValueOnce(
        jsonResponse(200, {
          upload_id: `upl_${"a".repeat(32)}`,
          format: "csv",
          encoding: "utf-8",
          size_bytes: 3,
          original_filename: "a.csv",
          created_at: "2026-01-01T00:00:00Z",
        }),
      );

    const result = await builderApi.uploadFile(new Blob(["a,b"]), { format: "csv" });

    expect(result.upload_id).toBe(`upl_${"a".repeat(32)}`);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const retryHeaders = (fetchMock.mock.calls[1]![1] as RequestInit).headers as Record<string, string>;
    expect(retryHeaders.Authorization).toBe("Bearer fresh-token");
  });
});

describe("provider status / credential CRUD contract (#S02)", () => {
  beforeEach(() => vi.restoreAllMocks());
  afterEach(() => vi.restoreAllMocks());

  function callOf(fetchMock: ReturnType<typeof vi.spyOn>) {
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    return { url, init };
  }

  it("getProviderStatus → GET /providers/{provider}/status", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse(200, {
        provider: "datago",
        status: "connected",
        configured: true,
        latency_ms: 12,
        checked_at: "2026-08-31T00:00:00.000Z",
      }),
    );

    await builderApi.getProviderStatus("datago");

    const { url, init } = callOf(fetchMock);
    expect(url).toBe(`${API_BASE}/providers/datago/status`);
    expect(init.method ?? "GET").toBe("GET");
  });

  it("putProviderCredential → PUT /providers/{provider}/credential with { credential } body", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(jsonResponse(200, {}));

    await builderApi.putProviderCredential("datago", "raw-secret");

    const { url, init } = callOf(fetchMock);
    expect(url).toBe(`${API_BASE}/providers/datago/credential`);
    expect(init.method).toBe("PUT");
    expect(JSON.parse(init.body as string)).toEqual({ credential: "raw-secret" });
  });

  it("deleteProviderCredential → DELETE /providers/{provider}/credential with no body", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(jsonResponse(200, {}));

    await builderApi.deleteProviderCredential("datago");

    const { url, init } = callOf(fetchMock);
    expect(url).toBe(`${API_BASE}/providers/datago/credential`);
    expect(init.method).toBe("DELETE");
    expect(init.body).toBeUndefined();
  });
});

describe("async build cancellation contract (#S03)", () => {
  beforeEach(() => vi.restoreAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it("cancelBuildJob → POST /builds/{run_id}/cancel", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse(200, {
        run_id: "weather-1",
        status: "cancelling",
        created_at: "2026-08-31T00:00:00.000Z",
        updated_at: "2026-08-31T00:00:01.000Z",
      }),
    );

    const job = await builderApi.cancelBuildJob("weather-1");

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${API_BASE}/builds/weather-1/cancel`);
    expect(init.method).toBe("POST");
    expect(job.status).toBe("cancelling");
  });

  it("does not retry cancelBuildJob on 5xx (비멱등 side effect)", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(jsonResponse(500, { error: "boom" }));

    await expect(builderApi.cancelBuildJob("weather-1")).rejects.toMatchObject({ status: 500 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("BuildJob response on the polling path (#603)", () => {
  beforeEach(() => vi.restoreAllMocks());
  afterEach(() => vi.restoreAllMocks());

  const base = {
    run_id: "run-1",
    created_at: "2026-10-01T00:00:00+00:00",
    updated_at: "2026-10-01T00:00:05+00:00",
  };
  const poll = (body: unknown) => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse(200, body));
    return builderApi.getBuildJob("run-1");
  };

  it("parses a job that failed before a build body existed, keeping Builder's reason", async () => {
    // What AsyncBuildExecutor stores when the provider client cannot be created.
    const job = await poll({
      ...base,
      status: "failed",
      response: { error: "provider client unavailable" },
      error: "provider client unavailable",
    });
    expect(job.status).toBe("failed");
    expect(job.error).toBe("provider client unavailable");
  });

  it("parses the contract's minimal succeeded job (getBuildJob/Succeeded)", async () => {
    const job = await poll({ ...base, status: "succeeded", response: { run_id: "run-1", status: "ok" } });
    expect(job.response).toEqual({ run_id: "run-1", status: "ok" });
  });

  it.each([
    ["omitted", {}],
    ["null", { response: null }],
    [
      "a full build response",
      {
        response: {
          status: "ok",
          run_id: "run-1",
          outcomes: [{ source_key: "air", status: "ok", stages_completed: ["bronze"], error: null }],
          manifest: "build/run-1/manifest.json",
          api_version: "1.64.0",
        },
      },
    ],
  ])("parses a succeeded job whose response is %s", async (_label, extra) => {
    await expect(poll({ ...base, status: "succeeded", ...extra })).resolves.toMatchObject({ status: "succeeded" });
  });

  it.each([
    ["an unknown status", { ...base, status: "exploded" }],
    ["a missing updated_at", { run_id: "run-1", status: "running", created_at: base.created_at }],
    ["a non-string run_id", { ...base, run_id: 1, status: "running" }],
    ["a response that is not an object", { ...base, status: "failed", response: "boom" }],
    ["a response that is an array", { ...base, status: "failed", response: [] }],
  ])("still rejects a job with %s", async (_label, body) => {
    await expect(poll(body)).rejects.toThrow();
  });
});

describe("probeProviderKey waits as long as Builder's probe can take (#768)", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  /** A fetch that answers after `ms`, unless its signal aborts first. */
  function slowFetch(ms: number, body: unknown) {
    return vi.spyOn(globalThis, "fetch").mockImplementation(
      (_input, init) =>
        new Promise<Response>((resolve, reject) => {
          const timer = setTimeout(() => resolve(jsonResponse(200, body)), ms);
          init?.signal?.addEventListener("abort", () => {
            clearTimeout(timer);
            reject(init.signal?.reason ?? new DOMException("Aborted", "AbortError"));
          });
        }),
    );
  }

  const PROBED = {
    provider: "datago",
    probed_at: "2026-10-06T09:30:00+00:00",
    complete: true,
    datasets: [{ dataset: "apt_trade", service_id: "svc", status: "available", detail: "", http_status: 200 }],
    not_probed: [],
  };

  it("reads a probe that answers after 50 seconds", async () => {
    vi.useFakeTimers();
    slowFetch(50_000, PROBED);

    const pending = builderApi.probeProviderKey("datago");
    await vi.advanceTimersByTimeAsync(50_000);

    await expect(pending).resolves.toMatchObject({ complete: true, datasets: [{ dataset: "apt_trade" }] });
  });

  it("still gives up on a probe that outlasts Builder's own bound", async () => {
    vi.useFakeTimers();
    slowFetch(120_000, PROBED);

    const pending = builderApi.probeProviderKey("datago");
    const outcome = pending.then(() => "answered", () => "gave up");
    await vi.advanceTimersByTimeAsync(PROBE_TIMEOUT_MS);

    await expect(outcome).resolves.toBe("gave up");
  });

  it("leaves every other call at the default 30 seconds", async () => {
    vi.useFakeTimers();
    slowFetch(50_000, { provider: "datago", status: "connected", configured: true, latency_ms: 1, checked_at: "2026-10-06T00:00:00+00:00" });

    const pending = builderApi.testProviderConnection("datago");
    const outcome = pending.then(() => "answered", () => "gave up");
    await vi.advanceTimersByTimeAsync(DEFAULT_TIMEOUT_MS);

    await expect(outcome).resolves.toBe("gave up");
    expect(PROBE_TIMEOUT_MS).toBeGreaterThan(60_000);
  });
});

describe("a renewed token that is still refused (#771)", () => {
  const REFUSED = { error: "email not verified", code: "unauthorized" };
  let renewals: number;

  beforeEach(() => {
    vi.restoreAllMocks();
    clearSessionRefusal();
    renewals = 0;
    setAuthTokenProvider(() => "token");
    // The identity provider renews every time: the token is not what is wrong.
    setAuthErrorCallback(() => {
      renewals += 1;
      return true;
    });
  });

  afterEach(() => {
    setAuthErrorCallback(null);
    setAuthTokenProvider(null);
    clearSessionRefusal();
    vi.restoreAllMocks();
  });

  it("resends once in all, however many queries follow, and records the reason once", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async () => jsonResponse(401, REFUSED));

    await expect(builderApi.version()).rejects.toMatchObject({ status: 401 });
    // The first query: sent, renewed, resent once.
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(renewals).toBe(1);
    expect(useSessionRefusalStore.getState().refusal).toEqual({ code: "unauthorized", reason: "email not verified" });

    for (let query = 0; query < 5; query += 1) {
      await expect(builderApi.listProviders()).rejects.toMatchObject({ status: 401 });
    }
    // Five more queries: one request each, no renewal, no resend.
    expect(fetchMock).toHaveBeenCalledTimes(7);
    expect(renewals).toBe(1);
    expect(useSessionRefusalStore.getState().refusal?.reason).toBe("email not verified");
  });

  it("recovers as before when the renewed token is accepted", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jsonResponse(401, { error: "token expired", code: "token_expired" }))
      .mockResolvedValueOnce(jsonResponse(200, { service: "kpubdata-builder", api_version: "1.0.0" }));

    await expect(builderApi.version()).resolves.toMatchObject({ api_version: "1.0.0" });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(renewals).toBe(1);
    expect(useSessionRefusalStore.getState().refusal).toBeNull();
  });

  it("tries again after the user asks, and forgets the refusal once a request is accepted", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async () => jsonResponse(401, REFUSED));
    await expect(builderApi.version()).rejects.toMatchObject({ status: 401 });
    expect(isSessionRefused()).toBe(true);

    clearSessionRefusal();
    fetchMock.mockImplementation(async () => jsonResponse(200, { service: "kpubdata-builder", api_version: "1.0.0" }));
    await expect(builderApi.version()).resolves.toMatchObject({ api_version: "1.0.0" });
    expect(isSessionRefused()).toBe(false);

    // And a refusal that stands is lifted by an accepted request without being asked.
    fetchMock.mockImplementation(async () => jsonResponse(401, REFUSED));
    await expect(builderApi.version()).rejects.toMatchObject({ status: 401 });
    expect(isSessionRefused()).toBe(true);
    fetchMock.mockImplementation(async () => jsonResponse(200, { service: "kpubdata-builder", api_version: "1.0.0" }));
    await expect(builderApi.version()).resolves.toBeDefined();
    expect(isSessionRefused()).toBe(false);
  });

  it("a 401 that could not be renewed is not this: the session is cleared by the auth layer", async () => {
    setAuthErrorCallback(() => false);
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => jsonResponse(401, REFUSED));

    await expect(builderApi.version()).rejects.toMatchObject({ status: 401 });

    expect(isSessionRefused()).toBe(false);
  });
});

describe("a response Studio cannot read is not a server error (#791)", () => {
  // Values that must never travel in the error: a person's name and a key-shaped string.
  const PERSON = "홍길동-canary";
  const KEY = "serviceKey-canary-0123456789";

  beforeEach(() => {
    vi.restoreAllMocks();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  async function rejectionOf(promise: Promise<unknown>): Promise<unknown> {
    try {
      await promise;
    } catch (cause) {
      return cause;
    }
    throw new Error("expected a rejection");
  }

  it("keeps the real status of a 200 whose JSON the schema rejects, names the fields and not their values", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(jsonResponse(200, { builds: [{ run_id: PERSON, status: KEY }], owner: PERSON }));

    const cause = await rejectionOf(builderApi.listBuilds());

    expect(cause).toBeInstanceOf(ContractMismatchError);
    expect(cause).toBeInstanceOf(ApiError);
    const error = cause as ContractMismatchError;
    expect(error.status).toBe(200);
    expect(error.code).toBe("schema_mismatch");
    expect(error.paths.length).toBeGreaterThan(0);
    expect(error.paths.some((path) => path.startsWith("builds.0"))).toBe(true);
    expect(error.details).toBeUndefined();
    const everything = JSON.stringify({ message: error.message, paths: error.paths, details: error.details });
    expect(everything).not.toContain(PERSON);
    expect(everything).not.toContain(KEY);
    // A GET is retried on 5xx; a mismatch is not a 5xx, so it is not sent again.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("keeps the real status of a 200 whose body is not JSON", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(`<html>${PERSON}</html>`, { status: 200 }));

    const error = (await rejectionOf(builderApi.listBuilds())) as ContractMismatchError;

    expect(error).toBeInstanceOf(ContractMismatchError);
    expect(error.status).toBe(200);
    expect(error.code).toBe("bad_json");
    expect(error.message).not.toContain(PERSON);
    expect(error.details).toBeUndefined();
  });

  it("still reports a real 500 as an ApiError with Builder's error body", async () => {
    vi.useFakeTimers();
    try {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse(500, { error: "boom", code: "internal" }));
      const pending = rejectionOf(builderApi.listBuilds());
      await vi.runAllTimersAsync();
      const error = (await pending) as ApiError;

      expect(error).toBeInstanceOf(ApiError);
      expect(error).not.toBeInstanceOf(ContractMismatchError);
      expect(error.status).toBe(500);
      expect(error.details).toEqual({ error: "boom", code: "internal" });
    } finally {
      vi.useRealTimers();
    }
  });

  it("treats an upload answer the schema rejects as a mismatch with the status Builder sent", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse(201, { upload_id: 42, filename: PERSON }));

    const error = (await rejectionOf(builderApi.uploadFile(new Blob(["a,b\n1,2"]), { format: "csv" }))) as ContractMismatchError;

    expect(error).toBeInstanceOf(ContractMismatchError);
    expect(error.status).toBe(201);
    expect(error.code).toBe("schema_mismatch");
    expect(error.details).toBeUndefined();
    expect(JSON.stringify({ message: error.message, paths: error.paths })).not.toContain(PERSON);
  });
});
