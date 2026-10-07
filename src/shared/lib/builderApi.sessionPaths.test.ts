/**
 * The upload and the binary downloads follow the same 401 policy as every JSON call (#789).
 *
 * They send with their own `fetch` — a raw body, a blob answer — and renewed the token on
 * every 401 without the checks #771 gave `apiFetch`: a session Builder refuses was renewed
 * and resent on each click, its reason was never recorded, and a refusal recorded by
 * another call did not stop them.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError, builderApi, resetAuthRenewalForTests, setAuthErrorCallback, setAuthTokenProvider } from "./builderApi";
import { clearSessionRefusal, isSessionRefused, useSessionRefusalStore } from "./sessionRefusal";

const REFUSED = { error: "email not verified", code: "unauthorized" };
const UPLOADED = {
  upload_id: `upl_${"a".repeat(32)}`,
  format: "csv",
  encoding: "utf-8",
  size_bytes: 3,
  original_filename: "a.csv",
  created_at: "2026-01-01T00:00:00Z",
};

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

/** Each path with a request that succeeds and the answer Builder gives when it does. */
const PATHS: Array<[string, () => Promise<unknown>, () => Response]> = [
  ["uploadFile", () => builderApi.uploadFile(new Blob(["a,b"]), { format: "csv" }), () => json(200, UPLOADED)],
  ["downloadArtifactFile", () => builderApi.downloadArtifactFile("run-1", "gold/data.jsonl"), () => new Response("rows", { status: 200 })],
  ["downloadWarehouseExport", () => builderApi.downloadWarehouseExport("exp-1"), () => new Response("zip", { status: 200 })],
];

let renewals: number;
let token: string;
let fetchMock: ReturnType<typeof vi.spyOn>;

function authorizationOf(call: number): string | undefined {
  const init = fetchMock.mock.calls[call]![1] as RequestInit;
  return (init.headers as Record<string, string>).Authorization;
}

beforeEach(() => {
  vi.restoreAllMocks();
  clearSessionRefusal();
  resetAuthRenewalForTests();
  renewals = 0;
  token = "stale-token";
  setAuthTokenProvider(() => token);
  // The identity provider renews every time it is asked.
  setAuthErrorCallback(() => {
    renewals += 1;
    token = `renewed-token-${renewals}`;
    return true;
  });
  fetchMock = vi.spyOn(globalThis, "fetch");
});

afterEach(() => {
  setAuthErrorCallback(null);
  setAuthTokenProvider(null);
  clearSessionRefusal();
  vi.restoreAllMocks();
});

describe.each(PATHS)("%s follows the shared 401 policy (#789)", (_name, call, accepted) => {
  it("is resent once with the renewed token when the first token had expired", async () => {
    fetchMock
      .mockResolvedValueOnce(json(401, { error: "token expired", code: "token_expired" }))
      .mockImplementationOnce(async () => accepted());

    await expect(call()).resolves.toBeDefined();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(renewals).toBe(1);
    expect(authorizationOf(0)).toBe("Bearer stale-token");
    expect(authorizationOf(1)).toBe("Bearer renewed-token-1");
    expect(isSessionRefused()).toBe(false);
  });

  it("stops after one resend when the renewed token is refused too, and records why", async () => {
    fetchMock.mockImplementation(async () => json(401, REFUSED));

    await expect(call()).rejects.toMatchObject({ status: 401 });

    // Sent, renewed, sent once more — the body goes out twice at most.
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(renewals).toBe(1);
    expect(useSessionRefusalStore.getState().refusal).toEqual({ code: "unauthorized", reason: "email not verified" });

    for (let click = 0; click < 4; click += 1) {
      await expect(call()).rejects.toMatchObject({ status: 401 });
    }
    // Four more clicks: one request each, no renewal, no resend.
    expect(fetchMock).toHaveBeenCalledTimes(6);
    expect(renewals).toBe(1);
  });

  it("neither renews nor resends while a refusal another call met still stands", async () => {
    fetchMock.mockImplementation(async () => json(401, REFUSED));
    await expect(builderApi.version()).rejects.toMatchObject({ status: 401 });
    expect(isSessionRefused()).toBe(true);
    const sent = fetchMock.mock.calls.length;

    await expect(call()).rejects.toMatchObject({ status: 401 });

    expect(fetchMock).toHaveBeenCalledTimes(sent + 1);
    expect(renewals).toBe(1);
  });

  it("does not renew again for a 401 that follows a renewal by a moment", async () => {
    // Another call has just renewed the token; this one is sent with it and refused.
    fetchMock.mockResolvedValueOnce(json(401, { error: "token expired", code: "token_expired" }));
    fetchMock.mockResolvedValueOnce(json(200, { service: "kpubdata-builder", api_version: "1.0.0" }));
    await builderApi.version();
    expect(renewals).toBe(1);
    fetchMock.mockImplementation(async () => json(401, REFUSED));

    await expect(call()).rejects.toMatchObject({ status: 401 });

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(renewals).toBe(1);
    expect(isSessionRefused()).toBe(true);
  });

  it("lifts a standing refusal when its request is accepted", async () => {
    fetchMock.mockImplementation(async () => json(401, REFUSED));
    await expect(builderApi.version()).rejects.toMatchObject({ status: 401 });
    expect(isSessionRefused()).toBe(true);

    fetchMock.mockImplementation(async () => accepted());
    await expect(call()).resolves.toBeDefined();

    expect(isSessionRefused()).toBe(false);
  });

  it("a 401 that cannot be renewed is left to the auth layer: nothing is resent or recorded", async () => {
    setAuthErrorCallback(() => false);
    fetchMock.mockImplementation(async () => json(401, REFUSED));

    await expect(call()).rejects.toMatchObject({ status: 401 });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(isSessionRefused()).toBe(false);
  });

  it("a failed connection is not a 401: no renewal, no resend, no refusal", async () => {
    fetchMock.mockImplementation(async () => {
      throw new TypeError("Failed to fetch");
    });

    await expect(call()).rejects.toMatchObject({ status: 0 });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(renewals).toBe(0);
    expect(isSessionRefused()).toBe(false);
  });

  it("another status is answered as it is, with no renewal", async () => {
    fetchMock.mockImplementation(async () => json(403, { error: "forbidden: not run owner" }));

    await expect(call()).rejects.toMatchObject({ status: 403 });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(renewals).toBe(0);
    expect(isSessionRefused()).toBe(false);
  });

  it("no token reaches the URL or the error", async () => {
    fetchMock.mockImplementation(async () => json(401, REFUSED));

    const refused = await call().then(
      () => null,
      (cause: unknown) => cause,
    );

    expect(refused).toBeInstanceOf(ApiError);
    const told = `${(refused as ApiError).message} ${JSON.stringify((refused as ApiError).details ?? null)}`;
    for (const sent of fetchMock.mock.calls) {
      expect(String(sent[0])).not.toMatch(/token/i);
    }
    expect(told).not.toContain("stale-token");
    expect(told).not.toContain("renewed-token");
  });
});

describe("cancelling a download (#789)", () => {
  it.each([
    ["downloadArtifactFile", (signal: AbortSignal) => builderApi.downloadArtifactFile("run-1", "gold/data.jsonl", signal)],
    ["downloadWarehouseExport", (signal: AbortSignal) => builderApi.downloadWarehouseExport("exp-1", signal)],
  ])("%s passes the caller's cancellation on and asks for nothing more", async (_name, call) => {
    const controller = new AbortController();
    fetchMock.mockImplementation(async () => {
      controller.abort();
      throw new DOMException("The operation was aborted.", "AbortError");
    });

    await expect(call(controller.signal)).rejects.toMatchObject({ name: "AbortError" });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(renewals).toBe(0);
    expect(isSessionRefused()).toBe(false);
  });
});
