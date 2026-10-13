/**
 * An accepted build submission outlives the screen that sent it (#986).
 *
 * `POST /builds` is a write that starts a build: once sent, Builder may accept it whatever
 * the browser does next. Leaving the screen stops the watching, never the submission, and
 * the screen opened again finds the job it started instead of forgetting it or sending it
 * twice. Navigation is injected at each boundary: before Builder accepts, after it accepts
 * but before the answer arrives, and when the answer is lost on the way back.
 */
import { act, renderHook } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useAuthStore } from "@/features/auth/store";
import { POLL_INTERVAL_MS } from "@/features/runs/api";
import { demoRunsClient, resetDemoJobsForTests } from "@/features/runs/api/client";
import { forgetBuildSubmissionsForTests, useBuildJob } from "@/features/runs/useBuildJob";
import { ApiError } from "@/shared/lib/builderApi";
import type { BuildSpec } from "@/shared/lib/types";

const SPEC: BuildSpec = {
  datasetId: "lifecycle",
  title: "Lifecycle",
  description: "",
  sources: [{ provider: "datago", dataset: "air_quality", params: {} }],
  exports: [{ format: "jsonl" }],
  metadata: {},
};

const SCOPE = "lifecycle-test";

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

/** A gate the test opens. */
function gate() {
  let open!: () => void;
  const opened = new Promise<void>((done) => {
    open = done;
  });
  return { opened, open };
}

const realSubmit = demoRunsClient.submit.bind(demoRunsClient);

/**
 * The demo Builder, with the answer to `POST /builds` held until the gate opens. `accept`
 * says whether the job is registered before the hold (Builder accepted, answer not yet
 * back) or after it (Builder has not accepted yet). The submit's signal is honoured as
 * the network would: an aborted request is refused.
 */
function holdSubmit(accept: "before-answer" | "after-hold") {
  const hold = gate();
  const submit = vi.spyOn(demoRunsClient, "submit").mockImplementation(async (yaml, runId, signal, retryOf) => {
    if (accept === "before-answer") {
      const job = await realSubmit(yaml, runId, undefined, retryOf);
      await hold.opened;
      if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
      return job;
    }
    await hold.opened;
    return realSubmit(yaml, runId, signal, retryOf);
  });
  return { submit, hold };
}

beforeEach(() => {
  resetDemoJobsForTests();
  forgetBuildSubmissionsForTests();
  vi.useFakeTimers();
});

afterEach(() => {
  useAuthStore.getState().clear();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("leaving while the submission is in flight", () => {
  it.each(["after-hold", "before-answer"] as const)(
    "accepted %s: the screen opened again follows the job, and nothing is sent twice",
    async (accept) => {
      const { submit, hold } = holdSubmit(accept);
      const first = renderHook(() => useBuildJob(SCOPE));
      act(() => {
        void first.result.current.start(SPEC);
      });
      await vi.waitFor(() => expect(submit).toHaveBeenCalledTimes(1));

      first.unmount();
      await act(async () => {
        hold.open();
        await vi.advanceTimersByTimeAsync(0);
      });

      const again = renderHook(() => useBuildJob(SCOPE));
      await vi.waitFor(() => expect(again.result.current.submittedRunId).toBeDefined());
      const runId = submit.mock.calls[0]![1];
      expect(again.result.current.submittedRunId).toBe(runId);
      expect(again.result.current.status).toBe("running");

      await act(async () => {
        await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 3);
      });
      expect(again.result.current.status).toBe("succeeded");
      expect(again.result.current.run?.id).toBe(runId);
      expect(submit).toHaveBeenCalledTimes(1);
    },
  );

  it("opened again before the answer: waits for it, then follows the job", async () => {
    const { submit, hold } = holdSubmit("after-hold");
    const first = renderHook(() => useBuildJob(SCOPE));
    act(() => {
      void first.result.current.start(SPEC);
    });
    await vi.waitFor(() => expect(submit).toHaveBeenCalledTimes(1));
    first.unmount();

    const again = renderHook(() => useBuildJob(SCOPE));
    expect(again.result.current.status).toBe("running");
    await act(async () => {
      hold.open();
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(again.result.current.submittedRunId).toBe(submit.mock.calls[0]![1]);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 3);
    });
    expect(again.result.current.status).toBe("succeeded");
    expect(submit).toHaveBeenCalledTimes(1);
  });

  it("under StrictMode, which mounts the screen twice, the job is still followed once", async () => {
    const { submit, hold } = holdSubmit("after-hold");
    const first = renderHook(() => useBuildJob(SCOPE));
    act(() => {
      void first.result.current.start(SPEC);
    });
    await vi.waitFor(() => expect(submit).toHaveBeenCalledTimes(1));
    first.unmount();
    await act(async () => {
      hold.open();
      await vi.advanceTimersByTimeAsync(0);
    });

    const getJob = vi.spyOn(demoRunsClient, "getJob");
    const again = renderHook(() => useBuildJob(SCOPE), { wrapper: StrictMode });
    await vi.waitFor(() => expect(again.result.current.submittedRunId).toBe(submit.mock.calls[0]![1]));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 3);
    });
    expect(again.result.current.status).toBe("succeeded");
    expect(submit).toHaveBeenCalledTimes(1);
    // queued -> running -> succeeded: one follower's reads, not two.
    expect(getJob.mock.calls.length).toBeLessThanOrEqual(3);
  });

  it("a cancel pressed before leaving reaches the job once Builder names it", async () => {
    const { submit, hold } = holdSubmit("after-hold");
    const cancel = vi.spyOn(demoRunsClient, "cancel");
    const first = renderHook(() => useBuildJob(SCOPE));
    act(() => {
      void first.result.current.start(SPEC);
    });
    await vi.waitFor(() => expect(submit).toHaveBeenCalledTimes(1));
    act(() => first.result.current.cancel());
    first.unmount();

    await act(async () => {
      hold.open();
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(cancel).toHaveBeenCalledWith(submit.mock.calls[0]![1]);

    const again = renderHook(() => useBuildJob(SCOPE));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 3);
    });
    expect(again.result.current.status).toBe("cancelled");
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it("a submission refused while away is said when the screen opens again, and not resent", async () => {
    const hold = gate();
    const submit = vi.spyOn(demoRunsClient, "submit").mockImplementation(async () => {
      await hold.opened;
      throw new ApiError(400, "spec refused", { error: "spec refused" });
    });
    const first = renderHook(() => useBuildJob(SCOPE));
    act(() => {
      void first.result.current.start(SPEC);
    });
    await vi.waitFor(() => expect(submit).toHaveBeenCalledTimes(1));
    first.unmount();
    await act(async () => {
      hold.open();
      await vi.advanceTimersByTimeAsync(0);
    });

    const again = renderHook(() => useBuildJob(SCOPE));
    await vi.waitFor(() => expect(again.result.current.status).toBe("failed"));
    expect(again.result.current.error).toBe("spec refused");
    expect(submit).toHaveBeenCalledTimes(1);

    // Said once: the screen opened a third time starts from nothing.
    again.unmount();
    const third = renderHook(() => useBuildJob(SCOPE));
    expect(third.result.current.status).toBe("idle");
  });

  it("another screen's submission is not shown here", async () => {
    const { submit, hold } = holdSubmit("after-hold");
    const first = renderHook(() => useBuildJob(SCOPE));
    act(() => {
      void first.result.current.start(SPEC);
    });
    await vi.waitFor(() => expect(submit).toHaveBeenCalledTimes(1));
    first.unmount();
    await act(async () => {
      hold.open();
      await vi.advanceTimersByTimeAsync(0);
    });

    const other = renderHook(() => useBuildJob("another-screen"));
    expect(other.result.current.status).toBe("idle");
    expect(other.result.current.submittedRunId).toBeUndefined();
  });
});

describe("another account", () => {
  it("never sees the job the previous account submitted, which that account finds again", async () => {
    signInAs("alice");
    const { submit, hold } = holdSubmit("after-hold");
    const first = renderHook(() => useBuildJob(SCOPE));
    act(() => {
      void first.result.current.start(SPEC);
    });
    await vi.waitFor(() => expect(submit).toHaveBeenCalledTimes(1));
    first.unmount();
    await act(async () => {
      hold.open();
      await vi.advanceTimersByTimeAsync(0);
    });

    signInAs("bob");
    const bob = renderHook(() => useBuildJob(SCOPE));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
    });
    expect(bob.result.current.status).toBe("idle");
    expect(bob.result.current.submittedRunId).toBeUndefined();
    bob.unmount();

    signInAs("alice");
    const alice = renderHook(() => useBuildJob(SCOPE));
    await vi.waitFor(() => expect(alice.result.current.submittedRunId).toBe(submit.mock.calls[0]![1]));
  });

  it("signing in while the submission is in flight: the screen drops it, the new account never sees it", async () => {
    signInAs("alice");
    const { submit, hold } = holdSubmit("after-hold");
    const { result } = renderHook(() => useBuildJob(SCOPE));
    act(() => {
      void result.current.start(SPEC);
    });
    await vi.waitFor(() => expect(submit).toHaveBeenCalledTimes(1));

    signInAs("bob");
    await act(async () => {
      hold.open();
      await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 3);
    });
    expect(result.current.status).toBe("idle");
    expect(result.current.submittedRunId).toBeUndefined();
    expect(submit).toHaveBeenCalledTimes(1);
  });
});

describe("the answer lost on the way back", () => {
  it("Builder accepted it: the job is found by its run id and followed, not sent again", async () => {
    const submit = vi.spyOn(demoRunsClient, "submit").mockImplementation(async (yaml, runId, _signal, retryOf) => {
      await realSubmit(yaml, runId, undefined, retryOf);
      throw new ApiError(0, "connection failed");
    });
    const { result } = renderHook(() => useBuildJob(SCOPE));
    let finished!: Promise<void>;
    act(() => {
      finished = result.current.start(SPEC);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 3);
      await finished;
    });

    expect(result.current.status).toBe("succeeded");
    expect(result.current.run?.id).toBe(submit.mock.calls[0]![1]);
    expect(submit).toHaveBeenCalledTimes(1);
  });

  it("whether Builder accepted it cannot be told: the user is told to look before starting again", async () => {
    const submit = vi.spyOn(demoRunsClient, "submit").mockRejectedValue(new ApiError(408, "timed out"));
    vi.spyOn(demoRunsClient, "getJob").mockRejectedValue(new ApiError(0, "connection failed"));
    const { result } = renderHook(() => useBuildJob(SCOPE));
    await act(async () => {
      await result.current.start(SPEC);
    });

    const runId = submit.mock.calls[0]![1];
    expect(result.current.status).toBe("failed");
    expect(result.current.error).toContain(runId);
    expect(submit).toHaveBeenCalledTimes(1);
  });

  it("Builder answered that it does not have the job: the user is still told to look", async () => {
    const submit = vi.spyOn(demoRunsClient, "submit").mockRejectedValue(new ApiError(0, "connection failed"));
    const { result } = renderHook(() => useBuildJob(SCOPE));
    await act(async () => {
      await result.current.start(SPEC);
    });

    expect(result.current.status).toBe("failed");
    expect(result.current.error).toContain(submit.mock.calls[0]![1]);
    expect(submit).toHaveBeenCalledTimes(1);
  });
});
