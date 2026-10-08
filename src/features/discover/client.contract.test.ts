/**
 * One contract, two clients — discover (#794).
 *
 * As `features/datasets/api/client.contract.test.ts`: the real client is pointed at a
 * Builder that answers with the demo's own catalogue, sent as JSON and read back through
 * Builder's response schema.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { demoDatasetsClient } from "@/features/datasets/api/client";
import { MOCK_DATASETS } from "@/features/datasets/api/mockData";
import { resetAuthRenewalForTests } from "@/shared/lib/builderApi";
import { clearSessionRefusal } from "@/shared/lib/sessionRefusal";
import { CREATED_TABLES_LIMIT, loadCreatedTables } from "./api";
import { demoDiscoverClient, realDiscoverClient, type DiscoverClient } from "./client";

/** A Builder that holds exactly what the demo holds. */
async function demoBuilder(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const signal = init?.signal ?? undefined;
  if (signal?.aborted) throw signal.reason ?? new DOMException("Aborted", "AbortError");
  const url = new URL(String(input), "http://builder.test");
  if (url.pathname.endsWith("/catalog")) return json(await demoDiscoverClient.catalog());
  if (url.pathname.endsWith("/datasets")) {
    return json(await demoDatasetsClient.listDatasets(Number(url.searchParams.get("limit") ?? 50)));
  }
  throw new Error(`the demo Builder has no route for ${url.pathname}`);
}

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
}

/** Each method once; held to the interface's methods by the first test. */
const CALLS: Array<[name: keyof DiscoverClient, call: (client: DiscoverClient, signal?: AbortSignal) => Promise<unknown>]> = [
  ["catalog", (client, signal) => client.catalog(signal)],
];

const CLIENTS: Array<[name: string, client: DiscoverClient]> = [
  ["demo", demoDiscoverClient],
  ["real", realDiscoverClient],
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

  expect(called).toEqual(Object.keys(demoDiscoverClient).sort());
  expect(called).toEqual(Object.keys(realDiscoverClient).sort());
});

describe("the two clients give the same answer", () => {
  it.each(CALLS)("%s", async (_name, call) => {
    const fromDemo = await call(demoDiscoverClient);
    const fromReal = await call(realDiscoverClient);

    // Through JSON and Builder's response schema, the demo's answer is unchanged.
    expect(fromReal).toStrictEqual(JSON.parse(JSON.stringify(fromDemo)));
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });
});

describe.each(CLIENTS)("the %s client", (_name, client) => {
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

describe("the tables made from each source", () => {
  afterEach(() => {
    delete window.__KPUBDATA_CONFIG__;
  });

  it.each([
    ["the demo", "false"],
    ["a Builder holding the demo's data", "true"],
  ])("%s: every table, and known to be all of them", async (_name, useRealBuilder) => {
    window.__KPUBDATA_CONFIG__ = { useRealBuilder };

    const created = await loadCreatedTables();

    // The flag was read: only a Builder is asked over HTTP. Without this, a flag that
    // did not take would have both cases reading the demo.
    expect(globalThis.fetch).toHaveBeenCalledTimes(useRealBuilder === "true" ? 1 : 0);
    expect(created.complete).toBe(true);
    expect(created.tables.map((table) => table.dataset_id)).toEqual(MOCK_DATASETS.datasets.map((table) => table.dataset_id));
    expect(MOCK_DATASETS.datasets.length).toBeLessThanOrEqual(CREATED_TABLES_LIMIT);
  });
});
