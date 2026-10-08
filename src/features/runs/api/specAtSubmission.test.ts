// @vitest-environment jsdom
/**
 * The spec of a run is kept when the run is submitted, not when it ends (#846).
 *
 * A job can wait a long time for a worker. The spec was saved only after polling had
 * seen the run end, so leaving the page, closing the tab or a poll that failed left a
 * run with no spec in this browser — and a run that then never starts has none on
 * Builder either.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { clearBuildSpecs, hasBuildSpec, loadBuildSpec } from "@/features/build-spec/specStore";
import { resetAuthRenewalForTests } from "@/shared/lib/builderApi";
import { clearSessionRefusal } from "@/shared/lib/sessionRefusal";
import type { BuildSpec } from "@/shared/lib/types";
import { executeBuild } from "./index";

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

function job(runId: string, status: string) {
  return { run_id: runId, status, created_at: "2026-10-08T01:00:00Z", updated_at: "2026-10-08T01:00:00Z" };
}

/** A Builder that accepts the job and then leaves it queued for as long as it is asked. */
function builderThatKeepsItQueued(polls: "answer queued" | "fail") {
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const signal = init?.signal ?? undefined;
    if (signal?.aborted) throw signal.reason ?? new DOMException("Aborted", "AbortError");
    const path = new URL(String(input), "http://builder.test").pathname;
    if (init?.method === "POST" && path.endsWith("/builds")) {
      const body: unknown = JSON.parse(String(init.body));
      const runId = typeof body === "object" && body !== null && "run_id" in body ? String(body.run_id) : "";
      return json(202, job(runId, "queued"));
    }
    if (polls === "fail") return json(503, { error: "restarting" });
    return json(200, job(path.split("/").pop() ?? "", "queued"));
  });
}

beforeEach(() => {
  clearSessionRefusal();
  resetAuthRenewalForTests();
  window.__KPUBDATA_CONFIG__ = { useRealBuilder: "true" };
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  clearBuildSpecs();
  delete window.__KPUBDATA_CONFIG__;
});

describe("executeBuild", () => {
  it("has kept the spec by the time the job is known to be submitted", async () => {
    builderThatKeepsItQueued("answer queued");
    const controller = new AbortController();
    let submitted: string | undefined;

    const run = executeBuild(SPEC, controller.signal, undefined, (handle) => {
      submitted = handle.runId;
    });
    run.catch(() => {});
    await vi.waitFor(() => expect(submitted).toBeDefined());
    const keptWhenSubmitted = hasBuildSpec(submitted ?? "");

    // The user leaves: polling stops with the run still queued.
    controller.abort();
    await expect(run).rejects.toMatchObject({ name: "AbortError" });

    expect(keptWhenSubmitted).toBe(true);
    expect(loadBuildSpec(submitted ?? "")?.datasetId).toBe("air-quality");
  });

  it("keeps it when polling fails before the run has ended", async () => {
    builderThatKeepsItQueued("fail");
    let submitted: string | undefined;

    const run = executeBuild(SPEC, undefined, undefined, (handle) => {
      submitted = handle.runId;
    });

    await expect(run).rejects.toBeDefined();
    expect(submitted).toBeDefined();
    expect(hasBuildSpec(submitted ?? "")).toBe(true);
  }, 30_000);

  it("keeps nothing for a submission Builder refused", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => json(400, { error: "invalid spec" }));

    await expect(executeBuild(SPEC)).rejects.toMatchObject({ status: 400 });

    const kept = Object.keys(localStorage).filter((key) => key.includes("build-specs"));
    expect(kept.map((key) => localStorage.getItem(key))).toEqual([]);
  });
});
