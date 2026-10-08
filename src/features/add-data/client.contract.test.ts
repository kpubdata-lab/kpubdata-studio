/**
 * One contract, two clients — Add Data (#794).
 *
 * As `features/datasets/api/client.contract.test.ts`: the real client is pointed at a
 * Builder that answers with the demo's own data, sent as JSON and read back through
 * Builder's response schemas.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { demoDiscoverClient } from "@/features/discover/client";
import { resetAuthRenewalForTests } from "@/shared/lib/builderApi";
import { clearSessionRefusal } from "@/shared/lib/sessionRefusal";
import { fetchProviderConfigured } from "./api";
import { demoAddDataClient, realAddDataClient, type AddDataClient } from "./client";

const FILE = new File(["region,value\nseoul,1\n"], "air quality.csv", { type: "text/csv" });

/** What the Builder below was last sent. */
let lastUpload: { query: URLSearchParams; bytes: number } | undefined;

/** A Builder that holds exactly what the demo holds. */
async function demoBuilder(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const signal = init?.signal ?? undefined;
  if (signal?.aborted) throw signal.reason ?? new DOMException("Aborted", "AbortError");
  const url = new URL(String(input), "http://builder.test");
  const method = init?.method ?? "GET";
  if (method === "GET" && url.pathname.endsWith("/catalog")) return json(await demoAddDataClient.catalog());
  if (method === "GET" && url.pathname.endsWith("/providers")) return json(await demoAddDataClient.providers());
  const test = /\/providers\/([^/]+)\/test$/.exec(url.pathname);
  if (method === "POST" && test) return json(await demoAddDataClient.testProvider(decodeURIComponent(test[1])));
  if (method === "POST" && url.pathname.endsWith("/uploads")) {
    const bytes = (init?.body as ArrayBuffer).byteLength;
    lastUpload = { query: url.searchParams, bytes };
    const sent = new File([new Uint8Array(bytes)], url.searchParams.get("filename") ?? "");
    return json(await demoAddDataClient.uploadFile(sent, url.searchParams.get("format") as "csv"));
  }
  throw new Error(`the demo Builder has no route for ${method} ${url.pathname}`);
}

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
}

/** Each method once; held to the interface's methods by the first test. */
const CALLS: Array<[name: keyof AddDataClient, call: (client: AddDataClient, signal?: AbortSignal) => Promise<unknown>]> = [
  ["catalog", (client, signal) => client.catalog(signal)],
  ["providers", (client, signal) => client.providers(signal)],
  ["testProvider", (client, signal) => client.testProvider("datago", signal)],
  ["uploadFile", (client, signal) => client.uploadFile(FILE, "csv", signal)],
];

const CLIENTS: Array<[name: string, client: AddDataClient]> = [
  ["demo", demoAddDataClient],
  ["real", realAddDataClient],
];

beforeEach(() => {
  clearSessionRefusal();
  resetAuthRenewalForTests();
  lastUpload = undefined;
  // The demo stamps a test and an upload with the time; hold it still to compare.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-08T00:00:00Z"));
  vi.spyOn(globalThis, "fetch").mockImplementation(demoBuilder);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  delete window.__KPUBDATA_CONFIG__;
});

it("has a call for each method of the interface", () => {
  const called = CALLS.map(([name]) => name).sort();

  expect(called).toEqual(Object.keys(demoAddDataClient).sort());
  expect(called).toEqual(Object.keys(realAddDataClient).sort());
});

describe("the two clients give the same answer", () => {
  it.each(CALLS)("%s", async (_name, call) => {
    const fromDemo = await call(demoAddDataClient);
    const fromReal = await call(realAddDataClient);

    // Through JSON and Builder's response schema, the demo's answer is unchanged.
    expect(fromReal).toStrictEqual(JSON.parse(JSON.stringify(fromDemo)));
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it("the real client sent the file itself, with its name and format", async () => {
    await realAddDataClient.uploadFile(FILE, "csv");

    expect(lastUpload?.bytes).toBe(FILE.size);
    expect(lastUpload?.query.get("filename")).toBe("air quality.csv");
    expect(lastUpload?.query.get("format")).toBe("csv");
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

describe.each([
  ["the demo", "false", 0],
  ["a Builder holding the demo's data", "true", 1],
])("which providers have a credential: %s", (_name, useRealBuilder, requests) => {
  it("reads it from the providers the client lists", async () => {
    window.__KPUBDATA_CONFIG__ = { useRealBuilder };

    expect(await fetchProviderConfigured()).toEqual({ datago: true });
    expect(globalThis.fetch).toHaveBeenCalledTimes(requests);
  });
});

describe("what is the demo's own", () => {
  it("does not read the file: any upload gets the same id", async () => {
    const other = new File(["x"], "other.csv");

    const first = await demoAddDataClient.uploadFile(FILE, "csv");
    const second = await demoAddDataClient.uploadFile(other, "csv");

    expect(second.upload_id).toBe(first.upload_id);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("answers connected for a provider it has never heard of", async () => {
    expect(await demoAddDataClient.testProvider("no-such-provider")).toMatchObject({
      status: "connected",
      configured: true,
    });
  });

  it("has a catalogue of its own, not the one the Catalog screen's demo shows", async () => {
    // Two fixtures answer the same `GET /catalog`: this one has what the workbench
    // demonstrates (a required parameter, an application link), the other has more
    // providers. Held here so that it is a known difference; when the two become one,
    // this fails and can go.
    const here = await demoAddDataClient.catalog();
    const there = await demoDiscoverClient.catalog();

    expect(here).not.toEqual(there);
    expect(here.providers.map((provider) => provider.name)).toEqual(["datago"]);
    expect(there.providers.map((provider) => provider.name)).toEqual(["datago", "kosis", "seoul"]);
  });
});
