/**
 * One contract, two clients — preview (#794).
 *
 * As `features/datasets/api/client.contract.test.ts`: the real client is pointed at a
 * Builder that answers `POST /preview` with the demo's own response, sent as JSON and
 * read back through Builder's response schema.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { resetAuthRenewalForTests } from "@/shared/lib/builderApi";
import { clearSessionRefusal } from "@/shared/lib/sessionRefusal";
import type { BuildSpec } from "@/shared/lib/types";
import { demoPreviewClient, realPreviewClient, type PreviewClient, type PreviewOptions } from "./client";
import { previewBuild, previewBuildDetailed } from "./index";

const SPEC: BuildSpec = {
  datasetId: "air-quality",
  title: "Air quality",
  description: "",
  sources: [{ provider: "datago", dataset: "air_quality", alias: "air", params: {} }],
  exports: [{ format: "jsonl" }],
  metadata: {},
};

/** What the Builder below was last sent, to see that the request carried the options. */
let lastRequest: { path: string; body: Record<string, unknown> } | undefined;

/** A Builder that previews as the demo does. */
async function demoBuilder(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const signal = init?.signal ?? undefined;
  if (signal?.aborted) throw signal.reason ?? new DOMException("Aborted", "AbortError");
  const path = new URL(String(input), "http://builder.test").pathname;
  if (init?.method !== "POST" || !path.endsWith("/preview")) {
    throw new Error(`the demo Builder has no route for ${init?.method} ${path}`);
  }
  const body = JSON.parse(String(init.body)) as Record<string, unknown>;
  lastRequest = { path, body };
  const { spec: _yaml, ...options } = body;
  const response = await demoPreviewClient.preview(SPEC, options as PreviewOptions);
  return new Response(JSON.stringify(response), { status: 200, headers: { "Content-Type": "application/json" } });
}

/** Each method once; held to the interface's methods by the first test. */
const CALLS: Array<[name: keyof PreviewClient, call: (client: PreviewClient, signal?: AbortSignal) => Promise<unknown>]> = [
  ["preview", (client, signal) => client.preview(SPEC, { limit: 3, sample_mode: "random", seed: 7 }, signal)],
];

const CLIENTS: Array<[name: string, client: PreviewClient]> = [
  ["demo", demoPreviewClient],
  ["real", realPreviewClient],
];

beforeEach(() => {
  clearSessionRefusal();
  resetAuthRenewalForTests();
  lastRequest = undefined;
  vi.spyOn(globalThis, "fetch").mockImplementation(demoBuilder);
});

afterEach(() => {
  vi.restoreAllMocks();
  delete window.__KPUBDATA_CONFIG__;
});

it("has a call for each method of the interface", () => {
  const called = CALLS.map(([name]) => name).sort();

  expect(called).toEqual(Object.keys(demoPreviewClient).sort());
  expect(called).toEqual(Object.keys(realPreviewClient).sort());
});

describe("the two clients give the same answer", () => {
  it.each(CALLS)("%s", async (_name, call) => {
    const fromDemo = await call(demoPreviewClient);
    const fromReal = await call(realPreviewClient);

    // Through JSON and Builder's response schema, the demo's answer is unchanged.
    expect(fromReal).toStrictEqual(JSON.parse(JSON.stringify(fromDemo)));
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    // The options went to Builder, and came back in the answer as the demo gives them.
    expect(lastRequest?.body).toMatchObject({ limit: 3, sample_mode: "random", seed: 7 });
    expect(fromReal).toMatchObject({ previews: [{ sample_mode: "random" }] });
  });

  it("the demo's schema names every column of its rows", async () => {
    const { previews } = await demoPreviewClient.preview(SPEC);
    const [source] = previews;

    expect(source.schema.map((column) => column.name).sort()).toEqual(Object.keys(source.sample[0]).sort());
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
  ["a Builder previewing as the demo does", "true", 1],
])("what the screens make of it: %s", (_name, useRealBuilder, requests) => {
  beforeEach(() => {
    window.__KPUBDATA_CONFIG__ = { useRealBuilder };
  });

  it("the flat table of one source", async () => {
    const table = await previewBuild(SPEC);

    expect(globalThis.fetch).toHaveBeenCalledTimes(requests);
    expect(table.warnings).toEqual([]);
    expect(table.schema).toEqual({ region: "string", value: "int64", measured_at: "string" });
    expect(table.rows).toHaveLength(3);
    expect(Object.keys(table.rows[0]).sort()).toEqual(Object.keys(table.schema).sort());
  });

  it("the whole response", async () => {
    const response = await previewBuildDetailed(SPEC, { sample_mode: "random" });

    expect(globalThis.fetch).toHaveBeenCalledTimes(requests);
    expect(response.dataset_id).toBe("air-quality");
    expect(response.previews).toHaveLength(1);
    expect(response.previews[0]).toMatchObject({ source_key: "air", status: "ok", sample_mode: "random" });
  });
});
