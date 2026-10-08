/**
 * One contract, two clients — artifacts (#794).
 *
 * As `features/datasets/api/client.contract.test.ts`: the real client is pointed at a
 * Builder that answers with the demo's own data, sent as JSON and read back through
 * Builder's response schemas, so a demo manifest the contract would reject or change
 * shows up as a difference between the two answers.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { i18n } from "@/shared/i18n";
import { resetAuthRenewalForTests } from "@/shared/lib/builderApi";
import { DEMO_DATASETS } from "@/shared/lib/demoDatasets";
import { clearSessionRefusal } from "@/shared/lib/sessionRefusal";
import { demoArtifactsClient, realArtifactsClient, type ArtifactsClient } from "./client";

/** One demo run in each state the demo has: finished, running, failed, queued. */
const RUNS = [...new Map(DEMO_DATASETS.map((dataset) => [dataset.status, dataset.buildId])).entries()];
/** The runs that have ended. A manifest is written when a run ends, so only these have one. */
const ENDED = RUNS.filter(([status]) => status === "succeeded" || status === "failed");
/** The runs that have not. Builder has no manifest for them; the demo makes one up. */
const NOT_ENDED = RUNS.filter(([status]) => status === "running" || status === "queued");

/** A Builder that holds exactly what the demo holds. */
async function demoBuilder(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const signal = init?.signal ?? undefined;
  if (signal?.aborted) throw signal.reason ?? new DOMException("Aborted", "AbortError");
  const path = new URL(String(input), "http://builder.test").pathname;
  const manifest = /\/builds\/([^/]+)\/manifest$/.exec(path);
  if (manifest) return json(await demoArtifactsClient.getBuildManifest(decodeURIComponent(manifest[1])));
  const files = /\/artifacts\/([^/]+)$/.exec(path);
  if (files) {
    const runId = decodeURIComponent(files[1]);
    return json({ run_id: runId, files: await demoArtifactsClient.listArtifactFiles(runId) });
  }
  throw new Error(`the demo Builder has no route for ${path}`);
}

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
}

/**
 * Each method once. A method added to the interface without a line here fails the
 * first test below, so it cannot go without the expectations every method has.
 */
const CALLS: Array<[name: keyof ArtifactsClient, call: (client: ArtifactsClient, signal?: AbortSignal) => Promise<unknown>]> = [
  ["getBuildManifest", (client, signal) => client.getBuildManifest(ENDED[0][1], signal)],
  ["listArtifactFiles", (client, signal) => client.listArtifactFiles(ENDED[0][1], signal)],
  ["downloadArtifact", (client, signal) => client.downloadArtifact(ENDED[0][1], "README.md", signal)],
];

const CLIENTS: Array<[name: string, client: ArtifactsClient]> = [
  ["demo", demoArtifactsClient],
  ["real", realArtifactsClient],
];

beforeEach(() => {
  clearSessionRefusal();
  resetAuthRenewalForTests();
  vi.spyOn(globalThis, "fetch").mockImplementation(demoBuilder);
});

afterEach(() => {
  vi.restoreAllMocks();
});

it("has a call for each method of the interface", () => {
  const called = CALLS.map(([name]) => name).sort();

  expect(called).toEqual(Object.keys(demoArtifactsClient).sort());
  expect(called).toEqual(Object.keys(realArtifactsClient).sort());
});

it("the demo has a run in every state to compare", () => {
  expect(RUNS.map(([status]) => status).sort()).toEqual(["failed", "queued", "running", "succeeded"]);
  expect(ENDED).toHaveLength(2);
  expect(NOT_ENDED).toHaveLength(2);
});

describe("the two clients give the same answer", () => {
  it.each(ENDED)("the manifest of a %s run", async (_status, runId) => {
    const fromDemo = await demoArtifactsClient.getBuildManifest(runId);
    const fromReal = await realArtifactsClient.getBuildManifest(runId);

    // Through JSON and Builder's manifest schema, the demo's manifest is unchanged.
    expect(fromReal).toStrictEqual(JSON.parse(JSON.stringify(fromDemo)));
  });

  it.each(RUNS)("the files of a %s run", async (_status, runId) => {
    expect(await realArtifactsClient.listArtifactFiles(runId)).toEqual(await demoArtifactsClient.listArtifactFiles(runId));
  });

  it("the real client did ask its Builder", async () => {
    await realArtifactsClient.getBuildManifest(RUNS[0][1]);

    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });
});

describe.each(CLIENTS)("the %s client answers for what it was asked", (_name, client) => {
  // Held by what was asked, not by the other client: both go through the demo's data.
  it("gives each run its own manifest and its own files", async () => {
    const [first, second] = DEMO_DATASETS.filter((dataset) => dataset.status === "succeeded").map((dataset) => dataset.buildId);
    expect(second).toBeDefined();

    const manifests = [await client.getBuildManifest(first), await client.getBuildManifest(second)];
    const files = [await client.listArtifactFiles(first), await client.listArtifactFiles(second)];

    expect(manifests.map((manifest) => manifest.build_id)).toEqual([first, second]);
    // Not empty: `every` is true of no files at all.
    expect(files[0].length).toBeGreaterThan(0);
    expect(files[1].length).toBeGreaterThan(0);
    expect(files[0].every((file) => file.includes(first))).toBe(true);
    expect(files[1].every((file) => file.includes(second))).toBe(true);
    expect(files[0]).not.toEqual(files[1]);
  });
});

describe.each(CLIENTS)("the %s client", (_name, client) => {
  it("lists files as run-relative POSIX paths", async () => {
    for (const [, runId] of RUNS) {
      for (const file of await client.listArtifactFiles(runId)) {
        expect(file).not.toMatch(/^\/|\\|^[A-Za-z]:/);
      }
    }
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

describe("what is the demo's own", () => {
  it("answers for a run id it does not know, where Builder would answer 404", async () => {
    const manifest = await demoArtifactsClient.getBuildManifest("no-such-run");

    expect(manifest.build_id).toBe("no-such-run");
  });

  it.each(NOT_ENDED)("has a manifest for a %s run, which Builder's contract does not allow", async (_status, runId) => {
    // A manifest in Builder's contract has `finished_at`; a run that has not ended has
    // no manifest at all there. The demo gives one without it, so a screen that reads
    // a manifest is shown something in the demo that no Builder would send. Held here
    // so that it is a known difference: when the demo stops doing this, this fails.
    const fromDemo = await demoArtifactsClient.getBuildManifest(runId);
    expect(fromDemo.finished_at).toBeUndefined();

    await expect(realArtifactsClient.getBuildManifest(runId)).rejects.toMatchObject({
      name: "ContractMismatchError",
    });
  });

  it("refuses a download rather than invent a file", async () => {
    await expect(demoArtifactsClient.downloadArtifact(RUNS[0][1], "README.md")).rejects.toThrow(
      i18n.t("artifacts.mockNoDownload"),
    );
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});
