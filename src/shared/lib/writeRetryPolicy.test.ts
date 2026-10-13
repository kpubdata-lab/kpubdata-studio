/**
 * A write is not sent again unless it says a repeat is safe (#990).
 *
 * The HTTP client used to retry every request on a network error, a timeout or a 5xx unless the
 * call opted out. `deleteAnalysis` did not opt out: when the delete was applied and only its
 * answer was lost, the repeat answered 404 and the screen showed a failure for a delete that had
 * worked. A GET is still retried by default; any other method is sent once unless it is listed in
 * `WRITES_SAFE_TO_REPEAT` below with the reason.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError, DEFAULT_RETRIES, DEFAULT_TIMEOUT_MS, builderApi, resetAuthRenewalForTests } from "./builderApi";
import { clearSessionRefusal } from "./sessionRefusal";

/** Every POST, PUT or DELETE in `builderApi.ts` that asks for a retry, and why its repeat is safe. */
const WRITES_SAFE_TO_REPEAT: Record<string, string> = {
  "POST /validate": "validation stores and starts nothing; it is a read sent as a POST because of its body",
  "PUT /revisions/${kind}/${encodeURIComponent(docId)}":
    "only when the body carries an idempotency_key: Builder answers a repeat with the revision the first attempt made",
};

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

/** Each `apiFetch(...)` call in the client's source, as `METHOD path` with the text of its `retries` option. */
function writeCallsInSource(): Array<{ call: string; retries: string | null }> {
  const source = readFileSync(fileURLToPath(new URL("./builderApi.ts", import.meta.url)), "utf8");
  const calls: Array<{ call: string; retries: string | null }> = [];
  for (const match of source.matchAll(/apiFetch(?:<[^>(]*>)?\(/g)) {
    let end = match.index + match[0].length;
    for (let depth = 1; depth > 0 && end < source.length; end += 1) {
      if (source[end] === "(") depth += 1;
      else if (source[end] === ")") depth -= 1;
    }
    const text = source.slice(match.index, end);
    const method = /method:\s*"(\w+)"/.exec(text)?.[1];
    if (!method || method === "GET") continue;
    const path = /[`"](\/[^`"]*)[`"]/.exec(text)?.[1] ?? "?";
    calls.push({ call: `${method} ${path}`, retries: /retries:\s*([^,}\n]+)/.exec(text)?.[1].trim() ?? null });
  }
  return calls;
}

beforeEach(() => {
  clearSessionRefusal();
  resetAuthRenewalForTests();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("the audit of writes in builderApi.ts", () => {
  const writes = writeCallsInSource();

  it("finds the client's writes", () => {
    expect(writes.length).toBeGreaterThan(20);
    expect(writes.map((write) => write.call)).toContain("DELETE /analyses/${encodeURIComponent(analysisId)}");
  });

  it("has every write state its retry count, so none depends on a default", () => {
    expect(writes.filter((write) => write.retries === null).map((write) => write.call)).toEqual([]);
  });

  it("lists every write that asks for a retry, with the reason", () => {
    const retried = writes.filter((write) => write.retries !== "0").map((write) => write.call);
    expect(retried.sort()).toEqual(Object.keys(WRITES_SAFE_TO_REPEAT).sort());
    for (const reason of Object.values(WRITES_SAFE_TO_REPEAT)) expect(reason.length).toBeGreaterThan(20);
  });
});

describe("a delete whose answer was lost", () => {
  it("is not sent again after a 5xx", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => jsonResponse(502, { error: "bad gateway" }));

    const outcome = builderApi.deleteAnalysis("an-1").catch((cause: unknown) => cause);
    await vi.advanceTimersByTimeAsync(10_000);

    expect(await outcome).toMatchObject({ status: 502 });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("is not sent again after a network error, so a delete that worked is not answered with 404", async () => {
    // The first attempt deletes the analysis and the connection drops; a second would find nothing.
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockImplementation(async () => jsonResponse(404, { error: "analysis not found", code: "not_found" }));

    const outcome = builderApi.deleteAnalysis("an-1").catch((cause: unknown) => cause);
    await vi.advanceTimersByTimeAsync(10_000);

    const cause = await outcome;
    expect(cause).toBeInstanceOf(ApiError);
    expect((cause as ApiError).status).toBe(0);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("is not sent again after a timeout", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(
      (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
        }),
    );

    const outcome = builderApi.deleteAnalysis("an-1").catch((cause: unknown) => cause);
    await vi.advanceTimersByTimeAsync(DEFAULT_TIMEOUT_MS * 4);

    expect(await outcome).toMatchObject({ status: 408 });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});

describe("what is still retried", () => {
  it("retries a GET on a 5xx", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async () => jsonResponse(503, { error: "busy" }));

    const outcome = builderApi.version().catch((cause: unknown) => cause);
    await vi.advanceTimersByTimeAsync(10_000);

    expect(await outcome).toMatchObject({ status: 503 });
    expect(fetchSpy).toHaveBeenCalledTimes(DEFAULT_RETRIES + 1);
  });

  it("retries POST /validate, which writes nothing", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => jsonResponse(503, { error: "busy" }));

    const outcome = builderApi.validate("name: x").catch((cause: unknown) => cause);
    await vi.advanceTimersByTimeAsync(10_000);

    expect(await outcome).toMatchObject({ status: 503 });
    expect(fetchSpy).toHaveBeenCalledTimes(DEFAULT_RETRIES + 1);
  });

  it("retries a revision save that carries an idempotency key, and sends one without a key once", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => jsonResponse(503, { error: "busy" }));
    const request = { content: { yaml: "name: x" }, expected_revision: 0 };

    const keyed = builderApi.saveRevision("spec", "doc-1", { ...request, idempotency_key: "k1" }).catch((cause: unknown) => cause);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(await keyed).toMatchObject({ status: 503 });
    expect(fetchSpy).toHaveBeenCalledTimes(DEFAULT_RETRIES + 1);

    fetchSpy.mockClear();
    const unkeyed = builderApi.saveRevision("spec", "doc-1", request).catch((cause: unknown) => cause);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(await unkeyed).toMatchObject({ status: 503 });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("does not retry a 429 on any method: Builder said when to come back", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => jsonResponse(429, { error: "slow down", code: "rate_limited" }));

    const read = builderApi.version().catch((cause: unknown) => cause);
    const write = builderApi.deleteAnalysis("an-1").catch((cause: unknown) => cause);
    await vi.advanceTimersByTimeAsync(10_000);

    expect(await read).toMatchObject({ status: 429 });
    expect(await write).toMatchObject({ status: 429 });
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });
});
