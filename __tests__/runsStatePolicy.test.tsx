/**
 * The server-state policy, held on the runs screens (#902; ARCHITECTURE.md, "서버 상태").
 *
 * - No shared cache: a screen holds what it loaded, and another account signing in (a new
 *   issuer#subject owner key) drops it and loads again.
 * - A request whose answer is no longer wanted — another run, another account — is aborted,
 *   so a late answer never lands.
 * - A screen asks once for what it shows; a second start of the same build is not a second
 *   submit.
 * - Cancel takes one path in both modes: the demo's jobs are submitted, polled and
 *   cancelled through the same client interface as a Builder's.
 */
import { act, render, renderHook, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useAuthStore } from "@/features/auth/store";
import { POLL_INTERVAL_MS } from "@/features/runs/api";
import {
  demoRunsClient,
  realRunsClient,
  resetDemoJobsForTests,
  type RunsClient,
} from "@/features/runs/api/client";
import { useBuild } from "@/features/runs/useBuild";
import { useBuildJob } from "@/features/runs/useBuildJob";
import { useSelectedRunPolling } from "@/features/runs/useSelectedRunPolling";
import { BuildsPage } from "@/pages/BuildsPage";
import { ApiError, builderApi, resetAuthRenewalForTests, type BuildJob, type BuildsResponse } from "@/shared/lib/builderApi";
import { clearSessionRefusal } from "@/shared/lib/sessionRefusal";
import type { BuildSpec } from "@/shared/lib/types";

const SPEC: BuildSpec = {
  datasetId: "policy",
  title: "Policy",
  description: "",
  sources: [{ provider: "datago", dataset: "air_quality", params: {} }],
  exports: [{ format: "jsonl" }],
  metadata: {},
};

function signInAs(userId: string) {
  act(() => {
    useAuthStore.getState().setOidcIdentity({
      email: `${userId}@example.test`,
      name: userId,
      userId,
      issuer: "https://idp.example.test/realms/kpubdata",
    });
  });
}

function history(...ids: string[]): BuildsResponse {
  return {
    builds: ids.map((id) => ({
      run_id: id,
      status: "ok" as const,
      started_at: "2026-10-01T00:00:00Z",
      finished_at: "2026-10-01T00:01:00Z",
      dataset_id: id,
      dataset_title: id,
    })),
  };
}

/** A promise held open, with the signal it was asked with. */
function held<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

/** A Builder whose job registry is the demo's, for the real client. */
async function demoBuilder(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const signal = init?.signal ?? undefined;
  if (signal?.aborted) throw signal.reason ?? new DOMException("Aborted", "AbortError");
  const path = new URL(String(input), "http://builder.test").pathname.replace(/^.*?(?=\/builds(\/|$))/, "");
  const [, , runId, action] = path.split("/");
  const method = init?.method ?? "GET";
  const answer = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  try {
    if (method === "POST" && path === "/builds") {
      const body = JSON.parse(String(init?.body)) as { spec: string; run_id: string };
      return answer(202, await demoRunsClient.submit(body.spec, body.run_id));
    }
    if (method === "POST" && action === "cancel") return answer(202, await demoRunsClient.cancel(decodeURIComponent(runId)));
    if (method === "GET" && runId && !action) return answer(200, await demoRunsClient.getJob(decodeURIComponent(runId)));
  } catch (error) {
    if (error instanceof ApiError) return answer(error.status, { error: error.message });
    throw error;
  }
  throw new Error(`no route for ${method} ${path}`);
}

beforeEach(() => {
  clearSessionRefusal();
  resetAuthRenewalForTests();
  resetDemoJobsForTests();
});

afterEach(() => {
  useAuthStore.getState().clear();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("cancel takes one path in both modes", () => {
  const MODES: Array<[name: string, real: boolean, client: RunsClient]> = [
    ["demo", false, demoRunsClient],
    ["real", true, realRunsClient],
  ];

  it.each(MODES)("%s: a queued build is cancelled once, and ends cancelled", async (_name, real, client) => {
    if (real) {
      vi.stubEnv("VITE_USE_REAL_BUILDER", "true");
      vi.spyOn(globalThis, "fetch").mockImplementation(demoBuilder);
    }
    vi.useFakeTimers();
    const cancel = vi.spyOn(client, "cancel");
    const { result } = renderHook(() => useBuildJob());

    let finished!: Promise<void>;
    act(() => {
      finished = result.current.start(SPEC);
    });
    await vi.waitFor(() => expect(result.current.submittedRunId).toBeDefined());
    act(() => {
      result.current.cancel();
      result.current.cancel();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 3);
      await finished;
    });

    expect(cancel).toHaveBeenCalledTimes(1);
    expect(cancel).toHaveBeenCalledWith(result.current.submittedRunId);
    expect(result.current.status).toBe("cancelled");
    expect(result.current.run?.status).toBe("cancelled");
  });

  it.each(MODES)("%s: a running build is cancelled cooperatively, through cancelling", async (_name, real) => {
    if (real) {
      vi.stubEnv("VITE_USE_REAL_BUILDER", "true");
      vi.spyOn(globalThis, "fetch").mockImplementation(demoBuilder);
    }
    vi.useFakeTimers();
    const { result } = renderHook(() => useBuildJob());

    let finished!: Promise<void>;
    act(() => {
      finished = result.current.start(SPEC);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
    });
    expect(result.current.builderStatus).toBe("running");
    act(() => result.current.cancel());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 2);
      await finished;
    });

    expect(result.current.status).toBe("cancelled");
  });
});

describe("another account signing in drops what the screen held", () => {
  function renderBuilds() {
    return render(
      <MemoryRouter initialEntries={["/refresh-jobs"]}>
        <Routes>
          <Route path="/refresh-jobs" element={<BuildsPage />} />
        </Routes>
      </MemoryRouter>,
    );
  }

  it("the refresh history: reloaded for the new owner, and a stale answer is aborted", async () => {
    vi.stubEnv("VITE_USE_REAL_BUILDER", "true");
    signInAs("alice");
    const signals: Array<AbortSignal | undefined> = [];
    const bobs = held<BuildsResponse>();
    const list = vi.spyOn(builderApi, "listBuilds").mockImplementation(async (_limit, signal) => {
      signals.push(signal);
      if (signals.length === 1) return history("alice-run");
      if (signals.length === 2) return bobs.promise;
      return history("carol-run");
    });

    renderBuilds();
    expect((await screen.findAllByText("alice-run")).length).toBeGreaterThan(0);
    // Asked once on mount.
    expect(list).toHaveBeenCalledTimes(1);

    signInAs("bob");
    await vi.waitFor(() => expect(list).toHaveBeenCalledTimes(2));
    // Alice's runs are gone before Bob's answer is in.
    expect(screen.queryAllByText("alice-run")).toHaveLength(0);

    signInAs("carol");
    await vi.waitFor(() => expect(list).toHaveBeenCalledTimes(3));
    expect(signals[1]?.aborted).toBe(true);
    expect((await screen.findAllByText("carol-run")).length).toBeGreaterThan(0);

    // Bob's answer arrives late, and changes nothing.
    await act(async () => bobs.resolve(history("bob-run")));
    expect(screen.queryAllByText("bob-run")).toHaveLength(0);
    expect(screen.getAllByText("carol-run").length).toBeGreaterThan(0);
  });

  it("a run: loaded again for the new owner, the earlier request aborted", async () => {
    const signals: Array<AbortSignal | undefined> = [];
    const first = held<never>();
    vi.spyOn(demoRunsClient, "getRun").mockImplementation((runId, signal) => {
      signals.push(signal);
      return signals.length === 1 ? first.promise : Promise.resolve({ id: runId, spec: SPEC, status: "succeeded", startedAt: "" });
    });
    signInAs("alice");
    const { result } = renderHook(() => useBuild("run-1"));
    await vi.waitFor(() => expect(signals).toHaveLength(1));

    signInAs("bob");
    await vi.waitFor(() => expect(result.current.build?.id).toBe("run-1"));
    expect(signals).toHaveLength(2);
    expect(signals[0]?.aborted).toBe(true);
    expect(signals[1]?.aborted).toBe(false);
  });

  it("a watched job: polled again for the new owner, the earlier request aborted", async () => {
    vi.stubEnv("VITE_USE_REAL_BUILDER", "true");
    const signals: Array<AbortSignal | undefined> = [];
    const first = held<BuildJob>();
    vi.spyOn(builderApi, "getBuildJob").mockImplementation((runId, signal) => {
      signals.push(signal);
      return signals.length === 1
        ? first.promise
        : Promise.resolve({ run_id: runId, status: "succeeded", created_at: "", updated_at: "" });
    });
    signInAs("alice");
    const { result } = renderHook(() => useSelectedRunPolling("run-1"));
    await vi.waitFor(() => expect(signals).toHaveLength(1));

    signInAs("bob");
    await vi.waitFor(() => expect(result.current).toMatchObject({ kind: "job", job: { status: "succeeded" } }));
    expect(signals[0]?.aborted).toBe(true);

    // Alice's answer arrives late, and changes nothing.
    await act(async () => first.resolve({ run_id: "run-1", status: "running", created_at: "", updated_at: "" }));
    expect(result.current).toMatchObject({ kind: "job", job: { status: "succeeded" } });
  });

  it("a build in progress: no longer watched, not cancelled, and the hook is idle again", async () => {
    vi.useFakeTimers();
    const cancel = vi.spyOn(demoRunsClient, "cancel");
    signInAs("alice");
    const { result } = renderHook(() => useBuildJob());

    act(() => {
      void result.current.start(SPEC);
    });
    await vi.waitFor(() => expect(result.current.submittedRunId).toBeDefined());
    const getJob = vi.spyOn(demoRunsClient, "getJob");

    signInAs("bob");
    expect(result.current.status).toBe("idle");
    expect(result.current.submittedRunId).toBeUndefined();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 3);
    });
    expect(getJob).not.toHaveBeenCalled();
    expect(cancel).not.toHaveBeenCalled();
    expect(result.current.status).toBe("idle");
  });
});

describe("a stale request is aborted, a duplicate one is not made", () => {
  it("a run: another run id aborts the request for the first", async () => {
    const signals: Array<AbortSignal | undefined> = [];
    vi.spyOn(demoRunsClient, "getRun").mockImplementation((runId, signal) => {
      signals.push(signal);
      return runId === "first" ? new Promise<never>(() => {}) : Promise.resolve({ id: runId, spec: SPEC, status: "succeeded", startedAt: "" });
    });
    const { result, rerender } = renderHook(({ id }) => useBuild(id), { initialProps: { id: "first" } });
    await vi.waitFor(() => expect(signals).toHaveLength(1));

    rerender({ id: "second" });
    await vi.waitFor(() => expect(result.current.build?.id).toBe("second"));
    expect(signals[0]?.aborted).toBe(true);
    expect(signals).toHaveLength(2);
  });

  it("a build started twice is submitted once, in the demo as with a Builder", async () => {
    vi.useFakeTimers();
    const submit = vi.spyOn(demoRunsClient, "submit");
    const { result } = renderHook(() => useBuildJob());

    act(() => {
      void result.current.start(SPEC);
      void result.current.start(SPEC);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 3);
    });

    expect(submit).toHaveBeenCalledTimes(1);
    expect(result.current.status).toBe("succeeded");
  });
});
