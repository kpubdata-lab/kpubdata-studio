/**
 * A request that has settled leaves nothing on the caller's abort signal (#985).
 *
 * A screen keeps one signal for as long as it is shown and hands it to every poll. The timeout
 * helper of the HTTP client and the polling `sleep` each put an abort listener on that signal and
 * never took it off, so the signal held one closure per request until the screen was left.
 *
 * Both ways the client follows the caller's signal are covered: `AbortSignal.any` where the
 * runtime has it, and a listener of its own where it does not.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { sleep } from "@/features/runs/api";
import { ApiError, DEFAULT_RETRIES, DEFAULT_TIMEOUT_MS, builderApi, resetAuthRenewalForTests } from "./builderApi";
import { clearSessionRefusal } from "./sessionRefusal";

const POLLS = 2000;

const JOB = {
  run_id: "run-1",
  status: "running",
  created_at: "2026-10-01T00:00:00+00:00",
  updated_at: "2026-10-01T00:00:05+00:00",
};

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

/** Counts the abort listeners put on and taken off `signal`, and how many fired (a fired `once` listener is gone). */
function watch(signal: AbortSignal) {
  const counts = { added: 0, removed: 0, fired: 0 };
  const live = new Set<unknown>();
  const add = signal.addEventListener.bind(signal);
  const remove = signal.removeEventListener.bind(signal);
  vi.spyOn(signal, "addEventListener").mockImplementation((type: string, listener: unknown, options?: unknown) => {
    if (type === "abort") {
      counts.added += 1;
      live.add(listener);
    }
    add(type, listener as EventListener, options as AddEventListenerOptions);
  });
  vi.spyOn(signal, "removeEventListener").mockImplementation((type: string, listener: unknown, options?: unknown) => {
    if (type === "abort" && live.delete(listener)) counts.removed += 1;
    remove(type, listener as EventListener, options as EventListenerOptions);
  });
  add("abort", () => {
    counts.fired = live.size;
    live.clear();
  });
  return { counts, left: () => live.size };
}

/** A fetch that never answers, and rejects with the signal's reason when it aborts. */
function hangingFetch() {
  return vi.spyOn(globalThis, "fetch").mockImplementation(
    (_input, init) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
      }),
  );
}

beforeEach(() => {
  clearSessionRefusal();
  resetAuthRenewalForTests();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe.each([
  ["AbortSignal.any", true],
  ["a listener of its own (no AbortSignal.any)", false],
])("the HTTP client following the caller's signal with %s", (_name, native) => {
  const any = AbortSignal.any;
  beforeEach(() => {
    if (!native) (AbortSignal as { any?: unknown }).any = undefined;
  });
  afterEach(() => {
    AbortSignal.any = any;
  });

  it(`leaves no listener on a signal reused by ${POLLS} successful polls`, async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => jsonResponse(200, JOB));
    const controller = new AbortController();
    const { counts, left } = watch(controller.signal);

    for (let i = 0; i < POLLS; i += 1) await builderApi.getBuildJob("run-1", controller.signal);

    expect(left()).toBe(0);
    expect(counts.added).toBe(native ? 0 : POLLS);
    expect(counts.removed).toBe(counts.added);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("releases the timer and the listener of every attempt when each one times out, and still answers 408", async () => {
    const fetchSpy = hangingFetch();
    const controller = new AbortController();
    const { counts, left } = watch(controller.signal);

    const outcome = builderApi.getBuildJob("run-1", controller.signal).then(
      () => null,
      (cause: unknown) => cause,
    );
    await vi.advanceTimersByTimeAsync((DEFAULT_TIMEOUT_MS + 5000) * (DEFAULT_RETRIES + 1));

    const cause = await outcome;
    expect(cause).toBeInstanceOf(ApiError);
    expect((cause as ApiError).status).toBe(408);
    // Every attempt timed out, and there was more than one.
    expect(fetchSpy.mock.calls.length).toBeGreaterThan(1);
    expect(fetchSpy.mock.calls.length).toBeLessThanOrEqual(DEFAULT_RETRIES + 1);
    expect(left()).toBe(0);
    expect(counts.removed).toBe(counts.added);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("passes the caller's cancellation through as it is, without a retry, and leaves no timer", async () => {
    const fetchSpy = hangingFetch();
    const controller = new AbortController();
    const { left } = watch(controller.signal);

    const outcome = builderApi.getBuildJob("run-1", controller.signal).then(
      () => null,
      (cause: unknown) => cause,
    );
    await vi.advanceTimersByTimeAsync(1000);
    controller.abort();

    const cause = await outcome;
    expect(cause).toBeInstanceOf(DOMException);
    expect((cause as DOMException).name).toBe("AbortError");
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(left()).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("releases each attempt of a request retried after a 5xx", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jsonResponse(503, { error: "busy" }))
      .mockResolvedValueOnce(jsonResponse(200, JOB));
    const controller = new AbortController();
    const { counts, left } = watch(controller.signal);

    const pending = builderApi.getBuildJob("run-1", controller.signal);
    await vi.advanceTimersByTimeAsync(5000);

    await expect(pending).resolves.toMatchObject({ run_id: "run-1" });
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(left()).toBe(0);
    expect(counts.removed).toBe(counts.added);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("cuts a request off when the caller's signal aborts", async () => {
    let sent: AbortSignal | undefined;
    vi.spyOn(globalThis, "fetch").mockImplementation((_input, init) => {
      sent = init?.signal ?? undefined;
      return new Promise<Response>(() => {});
    });
    const controller = new AbortController();
    void builderApi.getBuildJob("run-1", controller.signal).catch(() => {});
    await vi.advanceTimersByTimeAsync(0);

    expect(sent?.aborted).toBe(false);
    controller.abort();
    expect(sent?.aborted).toBe(true);
  });
});

describe("sleep", () => {
  it(`leaves no listener on a signal reused by ${POLLS} waits`, async () => {
    const controller = new AbortController();
    const { counts, left } = watch(controller.signal);

    for (let i = 0; i < POLLS; i += 1) {
      const waited = sleep(800, controller.signal);
      await vi.advanceTimersByTimeAsync(800);
      await waited;
    }

    expect(counts.added).toBe(POLLS);
    expect(counts.removed).toBe(POLLS);
    expect(left()).toBe(0);
  });

  it("still rejects with an AbortError and clears its timer when the signal aborts", async () => {
    const controller = new AbortController();
    const { counts } = watch(controller.signal);

    const waited = sleep(800, controller.signal).then(
      () => null,
      (cause: unknown) => cause,
    );
    controller.abort();

    const cause = await waited;
    expect((cause as DOMException).name).toBe("AbortError");
    expect(counts.fired).toBe(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("rejects at once on a signal that has already aborted, without a listener or a timer", async () => {
    const controller = new AbortController();
    controller.abort();
    const { counts } = watch(controller.signal);

    await expect(sleep(800, controller.signal)).rejects.toMatchObject({ name: "AbortError" });
    expect(counts.added).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });
});
