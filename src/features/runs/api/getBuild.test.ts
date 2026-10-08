// @vitest-environment jsdom
/**
 * A run that never started can still be loaded for editing (#846).
 *
 * Builder fails a job whose provider keys were gone before it calls `build()`, so the
 * run has no directory: no spec snapshot, no place in the history list, no manifest.
 * The edit page said its status could not be determined, although the job says how it
 * ended and this browser has the spec it submitted.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { clearBuildSpecs, saveBuildSpec } from "@/features/build-spec/specStore";
import { resetAuthRenewalForTests } from "@/shared/lib/builderApi";
import { clearSessionRefusal } from "@/shared/lib/sessionRefusal";
import type { BuildSpec } from "@/shared/lib/types";
import { getBuild } from "./getBuild";

const RUN = "air-quality-1";
const SPEC: BuildSpec = {
  datasetId: "air-quality",
  title: "Air quality",
  description: "Hourly air quality by region",
  sources: [{ provider: "datago", dataset: "air_quality", params: {} }],
  exports: [{ format: "jsonl" }],
  metadata: {},
};

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

/** What a Builder answers about a run. `undefined` for a route means 404. */
interface Known {
  job?: Record<string, unknown>;
  listed?: Record<string, unknown>;
  manifest?: Record<string, unknown>;
}

let asked: string[];

function builderThatKnows(known: Known) {
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const path = new URL(String(input), "http://builder.test").pathname;
    asked.push(path.replace(/^.*?(?=\/builds)/, ""));
    if (path.endsWith(`/builds/${RUN}/spec`)) return json(404, { error: "run not found" });
    if (path.endsWith(`/builds/${RUN}/manifest`)) {
      return known.manifest ? json(200, known.manifest) : json(404, { error: "run not found" });
    }
    if (path.endsWith("/builds")) return json(200, { builds: known.listed ? [known.listed] : [] });
    if (path.endsWith(`/builds/${RUN}`)) return known.job ? json(200, known.job) : json(404, { error: "job not found" });
    throw new Error(`unexpected request: ${path}`);
  });
}

const LOST_KEYS_JOB = {
  run_id: RUN,
  status: "failed",
  created_at: "2026-10-08T01:00:00Z",
  updated_at: "2026-10-08T02:00:00Z",
  error: "credentials_required: the keys this job was submitted with are gone",
  code: "credentials_required",
};

beforeEach(() => {
  asked = [];
  clearSessionRefusal();
  resetAuthRenewalForTests();
  window.__KPUBDATA_CONFIG__ = { useRealBuilder: "true" };
});

afterEach(() => {
  vi.restoreAllMocks();
  clearBuildSpecs();
  delete window.__KPUBDATA_CONFIG__;
});

describe("getBuild, for a run that has only a job", () => {
  it("loads it with this browser's spec and the job's status", async () => {
    saveBuildSpec(RUN, SPEC);
    builderThatKnows({ job: LOST_KEYS_JOB });

    const build = await getBuild(RUN);

    expect(build).toMatchObject({ id: RUN, status: "failed", startedAt: "2026-10-08T01:00:00Z" });
    expect(build.spec.datasetId).toBe("air-quality");
  });

  it.each(["cancelled", "succeeded"])("reads a %s job's status as it is", async (status) => {
    saveBuildSpec(RUN, SPEC);
    builderThatKnows({ job: { ...LOST_KEYS_JOB, status, error: null, code: undefined } });

    expect((await getBuild(RUN)).status).toBe(status);
  });

  it.each(["queued", "running", "cancelling"])("does not load a run whose job is still %s", async (status) => {
    // As before this change: the edit, run and publish pages take a run from here and
    // are written for one that has ended.
    saveBuildSpec(RUN, SPEC);
    builderThatKnows({ job: { ...LOST_KEYS_JOB, status, error: null, code: undefined } });

    await expect(getBuild(RUN)).rejects.toThrow(RUN);
  });

  it("asks the job only after the history list and the manifest had nothing", async () => {
    saveBuildSpec(RUN, SPEC);
    builderThatKnows({ job: LOST_KEYS_JOB });

    await getBuild(RUN);

    expect(asked.indexOf(`/builds/${RUN}`)).toBeGreaterThan(asked.indexOf(`/builds/${RUN}/manifest`));
    expect(asked.indexOf(`/builds/${RUN}/manifest`)).toBeGreaterThan(asked.indexOf("/builds"));
  });

  it("does not ask the job when the history list has the run", async () => {
    saveBuildSpec(RUN, SPEC);
    builderThatKnows({
      job: LOST_KEYS_JOB,
      listed: { run_id: RUN, status: "ok", started_at: "2026-10-08T01:00:00Z", finished_at: "2026-10-08T01:05:00Z" },
    });

    expect((await getBuild(RUN)).status).toBe("succeeded");
    expect(asked).not.toContain(`/builds/${RUN}`);
  });

  it("still says the status is unknown when there is no job either", async () => {
    saveBuildSpec(RUN, SPEC);
    builderThatKnows({});

    await expect(getBuild(RUN)).rejects.toThrow(RUN);
  });

  it("does not guess a status this Studio does not know", async () => {
    saveBuildSpec(RUN, SPEC);
    // The schema refuses an unknown job status, which reads as no job.
    builderThatKnows({ job: { ...LOST_KEYS_JOB, status: "paused" } });

    await expect(getBuild(RUN)).rejects.toThrow(RUN);
  });

  it("cannot load a run whose spec is nowhere, job or not", async () => {
    builderThatKnows({ job: LOST_KEYS_JOB });

    await expect(getBuild(RUN)).rejects.toThrow(RUN);
    // No spec, so the status was never looked for.
    expect(asked).toEqual([`/builds/${RUN}/spec`]);
  });
});
