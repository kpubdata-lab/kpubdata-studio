/**
 * A "new table" build asks Builder to refuse an existing table, and a refused table says
 * why (#881, builder#1223).
 *
 * Add Data checks the table list again right before submitting (#861), but another tab
 * can still make the table between that check and Builder's commit. Builder 1.114.0
 * closes the gap when the build says `if_absent`; Studio sends it for a new table, and
 * shows the `warehouse_failures` reason a refused commit comes back with.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { buildRunFromJob, executeBuild, POLL_INTERVAL_MS, warehouseFailureMessage } from "@/features/runs/api";
import { i18n } from "@/shared/i18n";
import { builderApi } from "@/shared/lib/builderApi";
import { BUILDER_ENUMS } from "@/shared/lib/builderEnums";
import type { BuildJob } from "@/shared/lib/builderApi.schema";
import type { BuildSpec } from "@/shared/lib/types";

const SPEC = {
  datasetId: "air",
  title: "air",
  description: "d",
  sources: [{ provider: "datago", dataset: "air_quality" }],
  exports: [],
} as unknown as BuildSpec;

const JOB = { run_id: "new-run", status: "queued", created_at: "t", updated_at: "t" };

beforeEach(() => {
  vi.stubEnv("VITE_USE_REAL_BUILDER", "true");
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

function captureBodies() {
  const bodies: Array<Record<string, unknown>> = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init: RequestInit) => {
      bodies.push(JSON.parse(String(init.body)) as Record<string, unknown>);
      return { ok: true, status: 200, headers: new Headers(), text: async () => JSON.stringify(JOB) } as unknown as Response;
    }),
  );
  return bodies;
}

describe("if_absent on the wire", () => {
  it("POST /builds carries it for a new table", async () => {
    const bodies = captureBodies();

    await builderApi.submitBuild("spec: 1", "new-run", undefined, undefined, true);

    expect(bodies).toEqual([{ spec: "spec: 1", run_id: "new-run", if_absent: true }]);
  });

  it("a refresh sends no such key", async () => {
    const bodies = captureBodies();

    await builderApi.submitBuild("spec: 1", "new-run", undefined, undefined, false);

    expect("if_absent" in bodies[0]).toBe(false);
  });

  it("executeBuild hands the option to the submission", async () => {
    vi.useFakeTimers();
    const submit = vi.spyOn(builderApi, "submitBuild").mockResolvedValue({
      ...JOB,
      status: "succeeded",
    } as never);

    const run = executeBuild(SPEC, undefined, undefined, undefined, { ifAbsent: true });
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 2);
    await run;

    expect(submit.mock.calls[0][4]).toBe(true);
  });
});

describe("a refused table commit says why", () => {
  const failed = (reason: string): BuildJob =>
    ({
      run_id: "r1",
      status: "failed",
      created_at: "t",
      updated_at: "t2",
      error: "build failed",
      response: { status: "ok", outcomes: [], warehouse_failures: { m: { reason, detail: "x" } } },
    }) as BuildJob;

  it.each([
    ["table_exists", "runs.build.tableExists"],
    ["empty_result", "runs.build.emptyResult"],
    ["conflict", "runs.build.commitConflict"],
    ["something_new", "runs.build.commitFailed"],
  ])("%s", (reason, key) => {
    const run = buildRunFromJob(failed(reason), SPEC, "start");

    expect(run.status).toBe("failed");
    expect(run.error).toBe(i18n.t(key, { table: "m" }));
    expect(run.error).not.toBe("build failed");
  });

  it("every reason the contract lists has its own sentence, and commit_failed the generic one", () => {
    const keys: Record<string, string> = {
      table_exists: "runs.build.tableExists",
      empty_result: "runs.build.emptyResult",
      conflict: "runs.build.commitConflict",
      commit_failed: "runs.build.commitFailed",
    };
    for (const reason of BUILDER_ENUMS["BuildSuccessResponse.warehouse_failures.reason"]) {
      expect(keys[reason], `no sentence for ${reason}`).toBeDefined();
      expect(buildRunFromJob(failed(reason), SPEC, "start").error).toBe(i18n.t(keys[reason], { table: "m" }));
    }
  });

  it("a job with no refused table keeps Builder's error", () => {
    const job = { ...failed("table_exists"), response: { status: "failed" }, error: "a: broke" } as BuildJob;

    expect(buildRunFromJob(job, SPEC, "start").error).toBe("a: broke");
    expect(warehouseFailureMessage(null)).toBeNull();
  });
});
