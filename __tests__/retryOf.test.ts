/**
 * A build started from a run that failed says which run it retries (#757).
 *
 * Builder's contract 1.85.0 takes `retry_of` on `POST /build` and `POST /builds`
 * (kpubdata-builder#1042): a run id is one attempt, and a retry is a new run that points at
 * the earlier one. Studio already made a new run id for every build; it sent no link back.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { executeBuild, POLL_INTERVAL_MS, retryOfFor } from "@/features/runs/api";
import { builderApi } from "@/shared/lib/builderApi";
import { buildJobSchema } from "@/shared/lib/builderApi.schema";
import type { BuildSpec } from "@/shared/lib/types";

function publicSpec(): BuildSpec {
  return {
    datasetId: "air",
    title: "air",
    description: "d",
    sources: [{ provider: "datago", dataset: "air_quality" }],
    exports: [],
  } as unknown as BuildSpec;
}

function fileSpec(): BuildSpec {
  return {
    datasetId: "upload",
    title: "upload",
    description: "d",
    sources: [{ kind: "file", uploadId: `upl_${"0".repeat(32)}`, format: "csv", params: {} }],
    exports: [],
  } as unknown as BuildSpec;
}

async function runPolled<T>(start: () => Promise<T>): Promise<T> {
  const promise = start();
  await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 8);
  return promise;
}

beforeEach(() => {
  vi.stubEnv("VITE_USE_REAL_BUILDER", "true");
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("which earlier run a build retries", () => {
  it.each(["failed", "cancelled"] as const)("a %s run is retried", (status) => {
    expect(retryOfFor({ id: "run-1", status })).toBe("run-1");
  });

  it.each(["succeeded", "running", "queued", "cancelling"] as const)(
    "running a %s run's spec again is not a retry of it",
    (status) => {
      expect(retryOfFor({ id: "run-1", status })).toBeUndefined();
    },
  );

  it("a build from scratch retries nothing", () => {
    expect(retryOfFor(null)).toBeUndefined();
    expect(retryOfFor(undefined)).toBeUndefined();
  });
});

describe("retry_of on the wire", () => {
  function captureBodies(answer: unknown) {
    const bodies: Array<Record<string, unknown>> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        bodies.push(JSON.parse(String(init.body)) as Record<string, unknown>);
        return { ok: true, status: 200, headers: new Headers(), text: async () => JSON.stringify(answer) } as unknown as Response;
      }),
    );
    return bodies;
  }

  const JOB = { run_id: "new-run", status: "queued", created_at: "t", updated_at: "t" };

  it("POST /builds carries it next to the new run id", async () => {
    const bodies = captureBodies(JOB);

    await builderApi.submitBuild("spec: 1", "new-run", undefined, "old-run");

    expect(bodies).toEqual([{ spec: "spec: 1", run_id: "new-run", retry_of: "old-run" }]);
  });

  it("POST /builds without a retry sends no such key", async () => {
    const bodies = captureBodies(JOB);

    await builderApi.submitBuild("spec: 1", "new-run");

    expect(bodies).toEqual([{ spec: "spec: 1", run_id: "new-run" }]);
    expect("retry_of" in bodies[0]).toBe(false);
  });

  it("POST /build carries it too", async () => {
    const bodies = captureBodies({ status: "ok", run_id: "new-run", manifest: "m", api_version: "1.85.0", outcomes: [] });

    await builderApi.build("spec: 1", "new-run", undefined, "old-run");

    expect(bodies).toEqual([{ spec: "spec: 1", run_id: "new-run", retry_of: "old-run" }]);
  });
});

describe("executeBuild passes the link to the route that runs the build", () => {
  it("async: POST /builds", async () => {
    const submit = vi.spyOn(builderApi, "submitBuild");

    await runPolled(() => executeBuild(publicSpec(), undefined, undefined, undefined, { retryOf: "old-run" }));

    expect(submit).toHaveBeenCalledTimes(1);
    expect(submit.mock.calls[0][3]).toBe("old-run");
    // A new run id of its own, not the earlier run's.
    expect(submit.mock.calls[0][1]).not.toBe("old-run");
  });

  it("async too for a spec with a file source (#786), never POST /build", async () => {
    const submit = vi.spyOn(builderApi, "submitBuild");
    const build = vi.spyOn(builderApi, "build");

    await runPolled(() => executeBuild(fileSpec(), undefined, undefined, undefined, { retryOf: "old-run" }));

    expect(submit).toHaveBeenCalledTimes(1);
    expect(submit.mock.calls[0][3]).toBe("old-run");
    expect(build).not.toHaveBeenCalled();
  });

  it("without the option nothing is named", async () => {
    const submit = vi.spyOn(builderApi, "submitBuild");

    await runPolled(() => executeBuild(publicSpec()));

    expect(submit.mock.calls[0][3]).toBeUndefined();
  });
});

describe("a job that is a retry", () => {
  const base = { run_id: "new-run", status: "succeeded", created_at: "t", updated_at: "t" };

  it("is read with the run it retries", () => {
    expect(buildJobSchema.parse({ ...base, retry_of: "old-run" }).retry_of).toBe("old-run");
  });

  it("is read the same without one", () => {
    expect(buildJobSchema.parse(base).retry_of).toBeUndefined();
  });
});
