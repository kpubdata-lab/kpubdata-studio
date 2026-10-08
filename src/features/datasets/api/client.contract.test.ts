/**
 * One contract, two clients (#794).
 *
 * `DatasetsClient` says what the datasets screens may rely on. Here the same
 * expectations run over both implementations, and the two are held to each other: the
 * real client is pointed at a Builder that answers with the demo's own data, sent as
 * JSON and read back through the response schemas of Builder's contract. If the demo
 * hands a screen something Builder's contract does not allow, or a shape that parsing
 * would change, the two answers differ and the test says where.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError, resetAuthRenewalForTests } from "@/shared/lib/builderApi";
import { clearSessionRefusal } from "@/shared/lib/sessionRefusal";
import { demoDatasetsClient, realDatasetsClient, type DatasetsClient } from "./client";
import { MOCK_DATASETS, MOCK_QUALITY, MOCK_RUNS, MOCK_STAGES } from "./mockData";

const DATASET = MOCK_DATASETS.datasets[0].dataset_id;
const RUN = MOCK_RUNS[DATASET].runs[0].run_id;
const STAGED_RUN = Object.keys(MOCK_STAGES)[0];
const STAGED_SOURCE = MOCK_STAGES[STAGED_RUN].sources[0].source_key;

/** A Builder that holds exactly what the demo holds. */
async function demoBuilder(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const signal = init?.signal ?? undefined;
  if (signal?.aborted) throw signal.reason ?? new DOMException("Aborted", "AbortError");
  const url = new URL(String(input), "http://builder.test");
  const path = url.pathname.replace(/^.*?(?=\/(datasets|builds|quality)(\/|$))/, "");
  const parts = path.split("/").filter(Boolean).map(decodeURIComponent);
  const limit = url.searchParams.get("limit");
  const number = (fallback: number) => (limit === null ? fallback : Number(limit));
  try {
    return json(200, await route(parts, url.searchParams, number));
  } catch (error) {
    if (error instanceof ApiError) return json(error.status, { error: error.message });
    throw error;
  }
}

function route(parts: string[], params: URLSearchParams, limit: (fallback: number) => number): Promise<unknown> {
  const demo = demoDatasetsClient;
  const [head, id, third, fourth] = parts;
  if (head === "datasets" && parts.length === 1) return demo.listDatasets(limit(50));
  if (head === "datasets" && parts.length === 2) return demo.getDataset(id);
  if (head === "datasets" && third === "runs" && parts.length === 3) return demo.listDatasetRuns(id, limit(50));
  if (head === "datasets" && third === "runs" && parts.length === 4) return demo.getDatasetRun(id, fourth);
  if (head === "datasets" && third === "quality" && fourth === "history") return demo.getDatasetQualityHistory(id, limit(30));
  if (head === "builds" && third === "stages" && parts.length === 3) return demo.listBuildStages(id);
  if (head === "builds" && third === "stages" && parts.length === 4) {
    if (!isStage(fourth)) throw new Error(`not a stage: ${fourth}`);
    return demo.getBuildStageDetail(id, fourth, params.get("source") ?? "", limit(5));
  }
  if (head === "builds" && third === "quality") return demo.getBuildQuality(id);
  if (head === "quality" && id === "issues") {
    return demo.listQualityIssues({ datasetId: params.get("dataset_id") ?? undefined, limit: limit(100) });
  }
  throw new Error(`the demo Builder has no route for /${parts.join("/")}`);
}

const STAGES = ["bronze", "silver", "gold"] as const;

function isStage(value: string | undefined): value is (typeof STAGES)[number] {
  return STAGES.some((stage) => stage === value);
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

/** Each method once, with arguments the demo has an answer for. */
const CALLS: Array<[name: string, call: (client: DatasetsClient, signal?: AbortSignal) => Promise<unknown>]> = [
  ["listDatasets", (client, signal) => client.listDatasets(50, signal)],
  ["listDatasets, limited", (client, signal) => client.listDatasets(1, signal)],
  ["getDataset", (client, signal) => client.getDataset(DATASET, signal)],
  ["listDatasetRuns", (client, signal) => client.listDatasetRuns(DATASET, 50, signal)],
  ["getDatasetRun", (client, signal) => client.getDatasetRun(DATASET, RUN, signal)],
  ["listBuildStages", (client, signal) => client.listBuildStages(STAGED_RUN, signal)],
  ["getBuildStageDetail, bronze", (client, signal) => client.getBuildStageDetail(STAGED_RUN, "bronze", STAGED_SOURCE, 5, signal)],
  ["getBuildStageDetail, silver", (client, signal) => client.getBuildStageDetail(STAGED_RUN, "silver", STAGED_SOURCE, 2, signal)],
  ["getBuildStageDetail, gold", (client, signal) => client.getBuildStageDetail(STAGED_RUN, "gold", STAGED_SOURCE, 5, signal)],
  ["getBuildQuality", (client, signal) => client.getBuildQuality(STAGED_RUN, signal)],
  ["listQualityIssues", (client, signal) => client.listQualityIssues({}, signal)],
  ["listQualityIssues, one table", (client, signal) => client.listQualityIssues({ datasetId: DATASET, limit: 3 }, signal)],
  ["getDatasetQualityHistory", (client, signal) => client.getDatasetQualityHistory(DATASET, 30, signal)],
];

/** Each method that takes an id, with one that names nothing. */
const MISSING: Array<[name: string, call: (client: DatasetsClient) => Promise<unknown>]> = [
  ["getDataset", (client) => client.getDataset("no-such-dataset")],
  ["listDatasetRuns", (client) => client.listDatasetRuns("no-such-dataset", 50)],
  ["getDatasetRun", (client) => client.getDatasetRun(DATASET, "no-such-run")],
  ["listBuildStages", (client) => client.listBuildStages("no-such-run")],
  ["getBuildStageDetail", (client) => client.getBuildStageDetail("no-such-run", "bronze", STAGED_SOURCE, 5)],
  ["getBuildQuality", (client) => client.getBuildQuality("no-such-run")],
  ["getDatasetQualityHistory", (client) => client.getDatasetQualityHistory("no-such-dataset", 30)],
];

const CLIENTS: Array<[name: string, client: DatasetsClient]> = [
  ["demo", demoDatasetsClient],
  ["real", realDatasetsClient],
];

beforeEach(() => {
  clearSessionRefusal();
  resetAuthRenewalForTests();
  vi.spyOn(globalThis, "fetch").mockImplementation(demoBuilder);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("every method of the interface is exercised", () => {
  it("has a call for each method", () => {
    const called = new Set(CALLS.map(([name]) => name.split(",")[0]));
    expect([...called].sort()).toEqual(Object.keys(demoDatasetsClient).sort());
    expect(Object.keys(realDatasetsClient).sort()).toEqual(Object.keys(demoDatasetsClient).sort());
  });
});

describe("the two clients give the same answer", () => {
  it.each(CALLS)("%s", async (_name, call) => {
    const fromDemo = await call(demoDatasetsClient);
    const fromReal = await call(realDatasetsClient);

    // Through JSON and Builder's response schema, the demo's answer is unchanged.
    expect(fromReal).toStrictEqual(JSON.parse(JSON.stringify(fromDemo)));
  });

  it("the real client did ask its Builder", async () => {
    await realDatasetsClient.getDataset(DATASET);

    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });
});

describe.each(CLIENTS)("the %s client answers for what it was asked", (_name, client) => {
  // Held by what was asked, not by the other client: both go through the demo's data,
  // so a demo that ignored an argument would still agree with itself.
  const OTHER = MOCK_DATASETS.datasets[1].dataset_id;

  it("lists no more tables than the limit, and says how many there are", async () => {
    const page = await client.listDatasets(2);

    expect(page.datasets).toHaveLength(2);
    expect(page.total).toBe(MOCK_DATASETS.datasets.length);
    expect(MOCK_DATASETS.datasets.length).toBeGreaterThan(2);
  });

  it("gives the table asked for", async () => {
    expect((await client.getDataset(DATASET)).dataset_id).toBe(DATASET);
    expect((await client.getDataset(OTHER)).dataset_id).toBe(OTHER);
  });

  it("gives the runs of the table asked for, no more than the limit", async () => {
    const all = await client.listDatasetRuns(DATASET, 50);
    const one = await client.listDatasetRuns(DATASET, 1);

    expect(all.runs).toEqual(MOCK_RUNS[DATASET].runs);
    expect(one.runs).toHaveLength(1);
    expect((await client.listDatasetRuns(OTHER, 50)).runs).toEqual(MOCK_RUNS[OTHER].runs);
  });

  it("gives the run asked for, of the table asked for", async () => {
    // A second run of the first table, and a run of another table: a client that
    // answered with the first run it has would give neither.
    const [, secondRun] = MOCK_RUNS[DATASET].runs;
    const otherRun = MOCK_RUNS[OTHER].runs[0];
    expect(secondRun).toBeDefined();

    expect(await client.getDatasetRun(DATASET, RUN)).toMatchObject({ dataset_id: DATASET, run: { run_id: RUN } });
    expect(await client.getDatasetRun(DATASET, secondRun.run_id)).toMatchObject({
      dataset_id: DATASET,
      run: { run_id: secondRun.run_id },
    });
    expect(await client.getDatasetRun(OTHER, otherRun.run_id)).toMatchObject({
      dataset_id: OTHER,
      run: { run_id: otherRun.run_id },
    });
  });

  it("gives the stages of the run asked for", async () => {
    const runs = Object.keys(MOCK_STAGES);
    expect(runs.length).toBeGreaterThan(1);

    for (const runId of runs.slice(0, 2)) {
      expect(await client.listBuildStages(runId)).toEqual(JSON.parse(JSON.stringify(MOCK_STAGES[runId])));
    }
  });

  it("gives the quality of the run asked for", async () => {
    const runs = Object.keys(MOCK_QUALITY);
    expect(runs.length).toBeGreaterThan(1);
    expect(JSON.stringify(MOCK_QUALITY[runs[0]])).not.toBe(JSON.stringify(MOCK_QUALITY[runs[1]]));

    for (const runId of runs.slice(0, 2)) {
      expect(await client.getBuildQuality(runId)).toEqual(JSON.parse(JSON.stringify(MOCK_QUALITY[runId])));
    }
  });

  it("gives the issues of the table asked for, no more than the limit", async () => {
    const everywhere = await client.listQualityIssues({});
    const here = await client.listQualityIssues({ datasetId: DATASET });
    const few = await client.listQualityIssues({ limit: 1 });

    expect(here.issues.every((issue) => issue.dataset_id === DATASET)).toBe(true);
    expect(here.coverage.tables).toBe(1);
    expect(everywhere.coverage.tables).toBe(MOCK_DATASETS.datasets.length);
    expect(everywhere.issues.length).toBeGreaterThan(1);
    expect(few.issues).toHaveLength(1);
  });
});

describe.each(CLIENTS)("the %s client", (_name, client) => {
  it.each(MISSING)("%s refuses an id that names nothing with a 404", async (_method, call) => {
    await expect(call(client)).rejects.toMatchObject({ name: "ApiError", status: 404 });
  });

  it.each(CALLS)("%s gives no answer once the caller has given up", async (_method, call) => {
    const controller = new AbortController();
    controller.abort();
    const settled = vi.fn();

    await call(client, controller.signal).then(settled, (error: unknown) => {
      expect(error).toMatchObject({ name: "AbortError" });
    });

    expect(settled).not.toHaveBeenCalled();
  });
});
