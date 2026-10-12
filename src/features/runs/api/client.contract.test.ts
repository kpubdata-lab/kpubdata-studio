// @vitest-environment jsdom
/**
 * One contract, two clients — runs (#902).
 *
 * As `features/publish/api/client.contract.test.ts`: the real client is pointed at a
 * Builder that answers with a demo client's own jobs, sent as JSON and read back through
 * Builder's response schemas. The job calls are what the two share, so those are what is
 * compared: the job at each step, the refusal for a run the registry does not have, and
 * what an aborted signal does. The one polling state machine (`executeBuild`) is then run
 * over both.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { clearBuildSpecs, loadBuildSpec } from "@/features/build-spec/specStore";
import { ApiError, resetAuthRenewalForTests, type BuildJob } from "@/shared/lib/builderApi";
import { buildJobSchema } from "@/shared/lib/builderApi.schema";
import { clearSessionRefusal } from "@/shared/lib/sessionRefusal";
import type { BuildSpec } from "@/shared/lib/types";
import { createDemoRunsClient, createRealRunsClient, MockUnsupportedError, runsClient, type RunsClient } from "./client";
import { demoHistory, executeBuild, mapBuildSummary, POLL_INTERVAL_MS, type BuilderJobStatus } from "./index";

const AT = "2026-10-12T00:00:00.000Z";
const SPEC_YAML = "dataset_id: demo\n";
const SPEC: BuildSpec = {
  datasetId: "contract-run",
  title: "Contract run",
  description: "A run for the contract test",
  sources: [{ provider: "datago", dataset: "apt_trade", params: {} }],
  exports: [{ format: "jsonl" }],
  metadata: {},
};

/** A demo whose builds take two reads to end, so that there is something to poll. */
const waitingDemo = (): RunsClient => createDemoRunsClient(demoHistory, { pollsUntilDone: 2, now: () => AT });

/** The demo the Builder below answers with. */
let served: RunsClient;
/** What the Builder below was sent, in order. */
let requests: Array<{ method: string; path: string; body: unknown }>;

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

/** A Builder whose job registry is `served`. */
async function demoBuilder(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const signal = init?.signal ?? undefined;
  if (signal?.aborted) throw signal.reason ?? new DOMException("Aborted", "AbortError");
  const url = new URL(String(input), "http://builder.test");
  const method = init?.method ?? "GET";
  const body: unknown = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
  requests.push({ method, path: url.pathname, body });
  const route = /\/builds(?:\/([^/]+)(\/cancel)?)?$/.exec(url.pathname);
  if (!route) throw new Error(`the demo Builder has no route for ${method} ${url.pathname}`);
  try {
    if (!route[1]) {
      const sent = body as { spec: string; run_id?: string; retry_of?: string };
      return json(202, await served.submitBuild(sent.spec, sent.run_id, undefined, sent.retry_of));
    }
    const runId = decodeURIComponent(route[1]);
    return json(200, route[2] ? await served.cancelBuildJob(runId) : await served.getBuildJob(runId));
  } catch (error) {
    if (!(error instanceof ApiError)) throw error;
    return json(error.status, { error: error.message });
  }
}

const real = createRealRunsClient(mapBuildSummary);

beforeEach(() => {
  requests = [];
  served = waitingDemo();
  clearSessionRefusal();
  resetAuthRenewalForTests();
  clearBuildSpecs();
  vi.spyOn(globalThis, "fetch").mockImplementation(demoBuilder);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  clearBuildSpecs();
});

/** Submit, read until it has ended, and give every job seen. */
async function lifeOf(client: RunsClient, runId: string): Promise<BuildJob[]> {
  const seen = [await client.submitBuild(SPEC_YAML, runId)];
  while (!["succeeded", "failed", "cancelled"].includes(seen[seen.length - 1]!.status)) {
    seen.push(await client.getBuildJob(runId));
  }
  return seen;
}

const CLIENTS: Array<[name: string, make: () => RunsClient]> = [
  ["the demo client", waitingDemo],
  ["the real client, over a Builder that answers as the demo does", () => real],
];

describe.each(CLIENTS)("%s", (_name, make) => {
  it("answers each step of a build with a job of Builder's shape", async () => {
    const jobs = await lifeOf(make(), "run-a");

    expect(jobs.map((job) => job.status)).toEqual(["queued", "running", "succeeded"]);
    for (const job of jobs) {
      expect(buildJobSchema.parse(job)).toEqual(job);
      expect(job.run_id).toBe("run-a");
    }
    expect(jobs[2]!.response).toMatchObject({ status: "ok", run_id: "run-a" });
  });

  it("answers a second submission under an id it has with that job, and starts nothing", async () => {
    const client = make();
    const first = await lifeOf(client, "run-a");

    expect(await client.submitBuild(SPEC_YAML, "run-a")).toEqual(first[first.length - 1]);
  });

  it("records the run a submission retries", async () => {
    const job = await make().submitBuild(SPEC_YAML, "run-b", undefined, "run-a");

    expect(job.retry_of).toBe("run-a");
  });

  it("ends a cancelled build as cancelled at the next read, and leaves an ended one as it is", async () => {
    const client = make();
    await client.submitBuild(SPEC_YAML, "run-a");

    expect((await client.cancelBuildJob("run-a")).status).toBe("cancelling");
    const ended = await client.getBuildJob("run-a");
    expect(ended.status).toBe("cancelled");
    expect((await client.cancelBuildJob("run-a")).status).toBe("cancelled");
    expect(await client.getBuildJob("run-a")).toEqual(ended);
  });

  it.each([
    ["getBuildJob", (client: RunsClient) => client.getBuildJob("never-submitted")],
    ["cancelBuildJob", (client: RunsClient) => client.cancelBuildJob("never-submitted")],
  ])("refuses %s for a run its registry does not have with 404", async (_method, call) => {
    const refusal = await call(make()).then(
      () => null,
      (error: unknown) => error,
    );

    expect(refusal).toBeInstanceOf(ApiError);
    expect((refusal as ApiError).status).toBe(404);
  });

  it.each([
    ["submitBuild", (client: RunsClient, signal: AbortSignal) => client.submitBuild(SPEC_YAML, "run-a", signal)],
    ["getBuildJob", (client: RunsClient, signal: AbortSignal) => client.getBuildJob("run-a", signal)],
    ["cancelBuildJob", (client: RunsClient, signal: AbortSignal) => client.cancelBuildJob("run-a", signal)],
  ])("rejects %s without an answer when the signal is already aborted", async (_method, call) => {
    const controller = new AbortController();
    controller.abort();

    await expect(call(make(), controller.signal)).rejects.toMatchObject({ name: "AbortError" });
  });
});

describe("the demo's own, as its header says", () => {
  const demo = () => createDemoRunsClient(demoHistory, { now: () => AT });

  it("ends a build at submission", async () => {
    const job = await demo().submitBuild(SPEC_YAML, "run-a");

    expect(job.status).toBe("succeeded");
    expect(buildJobSchema.parse(job)).toEqual(job);
  });

  it("knows no job of the runs in its history", async () => {
    const client = demo();
    const listed = await client.listBuilds();

    expect(listed.length).toBeGreaterThan(0);
    await expect(client.getBuildJob(listed[0]!.id)).rejects.toMatchObject({ status: 404 });
  });

  it("lists its history, runs in progress included, and no more than asked for", async () => {
    const client = demo();

    expect(await client.listBuilds()).toEqual(demoHistory());
    expect((await client.listBuilds()).some((run) => run.status === "running" || run.status === "queued")).toBe(true);
    expect(await client.listBuilds(2)).toEqual(demoHistory().slice(0, 2));
  });

  it("has no spec snapshot and no event timeline, and says so as that, not as a failure", async () => {
    await expect(demo().getBuildSpecSnapshot("run-a")).rejects.toBeInstanceOf(MockUnsupportedError);
    await expect(demo().getBuildEvents("run-a")).rejects.toBeInstanceOf(MockUnsupportedError);
  });
});

describe("executeBuild is one state machine over both", () => {
  it("in the demo: goes through the job path and ends at once, under the id it was submitted as", async () => {
    const statuses: BuilderJobStatus[] = [];
    const handles: string[] = [];

    const run = await executeBuild(SPEC, undefined, (status) => statuses.push(status), (handle) => handles.push(handle.runId));

    expect(run.status).toBe("succeeded");
    expect(run.id).toMatch(/^contract-run-\d+-[a-z0-9]+$/);
    expect(handles).toEqual([run.id]);
    expect(statuses).toEqual(["succeeded"]);
    expect(loadBuildSpec(run.id)).toEqual(SPEC);
    // Nothing was sent anywhere, and the job is in the demo's registry.
    expect(requests).toEqual([]);
    expect((await runsClient().getBuildJob(run.id)).status).toBe("succeeded");
  });

  it("with a Builder: polls the same jobs to the same end", async () => {
    vi.stubEnv("VITE_USE_REAL_BUILDER", "true");
    vi.useFakeTimers();
    const statuses: BuilderJobStatus[] = [];

    const building = executeBuild(SPEC, undefined, (status) => statuses.push(status));
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 3);
    const run = await building;

    expect(run.status).toBe("succeeded");
    expect(statuses).toEqual(["queued", "running", "succeeded"]);
    expect(requests.map((request) => request.method)).toEqual(["POST", "GET", "GET"]);
    expect(requests[0]!.body).toMatchObject({ run_id: run.id });
  });

  it("with a Builder: a build cancelled while it waits ends cancelled", async () => {
    vi.stubEnv("VITE_USE_REAL_BUILDER", "true");
    vi.useFakeTimers();
    let runId = "";

    const building = executeBuild(SPEC, undefined, undefined, (handle) => {
      runId = handle.runId;
    });
    await vi.advanceTimersByTimeAsync(0);
    await runsClient().cancelBuildJob(runId);
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);

    expect((await building).status).toBe("cancelled");
  });
});
