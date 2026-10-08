/**
 * One contract, two clients — publish (#794).
 *
 * As `features/datasets/api/client.contract.test.ts`: the real client is pointed at a
 * Builder that answers with the demo's own data, sent as JSON and read back through
 * Builder's response schemas. Publishing is also refused in places, so the refusals are
 * compared too: the status, and the `code` the screens branch on.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError, resetAuthRenewalForTests, type PublishReadinessResponse } from "@/shared/lib/builderApi";
import { publishRequestSchema } from "@/shared/lib/builderApi.schema";
import { clearSessionRefusal } from "@/shared/lib/sessionRefusal";
import { createDemoPublishClient, demoPublishClient, realPublishClient, type PublishClient } from "./client";
import { describePublishFailure, publishBuild, reconcilePublish, resetPublishReceipt } from "./index";
import { MOCK_PUBLISH_READINESS } from "./mockData";

const RUNS = Object.keys(MOCK_PUBLISH_READINESS);
const READY = RUNS.find((run) => MOCK_PUBLISH_READINESS[run].ready && MOCK_PUBLISH_READINESS[run].blockers.length === 0)!;
const NOT_READY = RUNS.find((run) => !MOCK_PUBLISH_READINESS[run].ready || MOCK_PUBLISH_READINESS[run].blockers.length > 0)!;
const DESTINATION = "kpubdata/air-quality";
const CREDENTIAL = { HF_TOKEN: "hf_not_a_real_token" };

/** What the Builder below was last sent. */
let lastRequest: { method: string; url: URL; headers: Record<string, string>; body: string | undefined } | undefined;

/** The demo the Builder below answers with: the real one, unless a test puts another in. */
let served: PublishClient = demoPublishClient;

function headersOf(init?: RequestInit): Record<string, string> {
  return Object.fromEntries(new Headers(init?.headers).entries());
}

function reconcileRequest(body: string | undefined): { target: "huggingface"; destination: string } {
  const parsed: unknown = JSON.parse(body ?? "{}");
  const destination =
    typeof parsed === "object" && parsed !== null && "destination" in parsed ? String(parsed.destination) : "";
  return { target: "huggingface", destination };
}

/** A Builder that holds exactly what the demo holds. */
async function demoBuilder(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const signal = init?.signal ?? undefined;
  if (signal?.aborted) throw signal.reason ?? new DOMException("Aborted", "AbortError");
  const url = new URL(String(input), "http://builder.test");
  const method = init?.method ?? "GET";
  const body = typeof init?.body === "string" ? init.body : undefined;
  lastRequest = { method, url, headers: headersOf(init), body };
  const route = /\/builds\/([^/]+)\/publish(\/readiness|\/reconcile|\/receipt)?$/.exec(url.pathname);
  if (!route) throw new Error(`the demo Builder has no route for ${method} ${url.pathname}`);
  const runId = decodeURIComponent(route[1]);
  try {
    if (route[2] === "/readiness") return json(200, await served.readiness(runId, "huggingface"));
    if (route[2] === "/reconcile") return json(200, await served.reconcile(runId, reconcileRequest(body)));
    if (route[2] === "/receipt") {
      return json(200, await served.resetReceipt(runId, "huggingface", url.searchParams.get("destination") ?? ""));
    }
    // Read as Builder reads it: a request the contract would refuse is not published.
    return json(200, await served.publish(runId, publishRequestSchema.parse(JSON.parse(body ?? "{}"))));
  } catch (error) {
    if (!(error instanceof ApiError)) throw error;
    const details = typeof error.details === "object" && error.details !== null ? error.details : {};
    return json(error.status, { error: error.message, ...details });
  }
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

type Call = (client: PublishClient, signal?: AbortSignal) => Promise<unknown>;

/** Each method once, with arguments the demo answers; held to the interface by the first test. */
const CALLS: Array<[name: keyof PublishClient, call: Call]> = [
  ["readiness", (client, signal) => client.readiness(READY, "huggingface", signal)],
  ["publish", (client, signal) => client.publish(READY, { target: "huggingface", destination: DESTINATION }, signal)],
  ["reconcile", (client, signal) => client.reconcile(READY, { target: "huggingface", destination: DESTINATION }, signal)],
  ["resetReceipt", (client, signal) => client.resetReceipt(READY, "huggingface", DESTINATION, signal)],
];

/** Calls that are refused, with the status and `code` both clients must give. */
const REFUSALS: Array<[name: string, call: Call, status: number, code: string | undefined]> = [
  ["readiness of a run that is not there", (client) => client.readiness("no-such-run", "huggingface"), 404, undefined],
  ["publish of a run that is not there", (client) => client.publish("no-such-run", { target: "huggingface", destination: DESTINATION }), 404, undefined],
  // The demo's way of refusing: a Builder sends its blockers here (see "what is the demo's own").
  ["publish of a run that is not ready", (client) => client.publish(NOT_READY, { target: "huggingface", destination: DESTINATION }), 409, "publish_conflict"],
  ["reconcile with no receipt", (client) => client.reconcile(READY, { target: "huggingface", destination: DESTINATION }), 404, "receipt_not_found"],
  ["reset with no receipt", (client) => client.resetReceipt(READY, "huggingface", DESTINATION), 404, "receipt_not_found"],
];

const CLIENTS: Array<[name: string, client: PublishClient]> = [
  ["demo", demoPublishClient],
  ["real", realPublishClient],
];

beforeEach(() => {
  clearSessionRefusal();
  resetAuthRenewalForTests();
  lastRequest = undefined;
  served = demoPublishClient;
  vi.spyOn(globalThis, "fetch").mockImplementation(demoBuilder);
});

afterEach(() => {
  vi.restoreAllMocks();
  delete window.__KPUBDATA_CONFIG__;
});

it("has a call for each method of the interface, and the demo has both kinds of run", () => {
  const called = CALLS.map(([name]) => name).sort();

  expect(called).toEqual(Object.keys(demoPublishClient).sort());
  expect(called).toEqual(Object.keys(realPublishClient).sort());
  expect(READY).toBeDefined();
  expect(NOT_READY).toBeDefined();
});

describe("the two clients give the same answer", () => {
  it.each(RUNS)("the readiness of %s", async (runId) => {
    const fromDemo = await demoPublishClient.readiness(runId, "huggingface");
    const fromReal = await realPublishClient.readiness(runId, "huggingface");

    // Through JSON and Builder's response schema, the demo's answer is unchanged.
    expect(fromReal).toStrictEqual(JSON.parse(JSON.stringify(fromDemo)));
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["private by default", {}],
    ["public", { private: false }],
  ])("a publish, %s", async (_name, options) => {
    const request = { target: "huggingface" as const, destination: DESTINATION, options };
    const fromDemo = await demoPublishClient.publish(READY, request);
    const fromReal = await realPublishClient.publish(READY, request);

    expect(fromReal).toStrictEqual(JSON.parse(JSON.stringify(fromDemo)));
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });
});

function codeOf(error: ApiError): unknown {
  const details: unknown = error.details;
  return typeof details === "object" && details !== null && "code" in details ? details.code : undefined;
}

describe.each(CLIENTS)("the %s client", (name, client) => {
  it.each(REFUSALS)("refuses %s", async (_what, call, status, code) => {
    const refusal: unknown = await call(client).then(
      () => undefined,
      (error: unknown) => error,
    );

    if (!(refusal instanceof ApiError)) throw new Error(`expected an ApiError, got ${String(refusal)}`);
    expect(refusal.status).toBe(status);
    expect(codeOf(refusal)).toBe(code);
    // The demo refuses by itself; a Builder is asked once, and not again.
    expect(globalThis.fetch).toHaveBeenCalledTimes(name === "real" ? 1 : 0);
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

describe.each(CLIENTS)("the %s client answers for what it was asked", (_name, client) => {
  // Values that are not the ones the demo would give if it ignored what it was asked.
  it("gives each run its own readiness", async () => {
    const ready = await client.readiness(READY, "huggingface");
    const notReady = await client.readiness(NOT_READY, "huggingface");

    expect(ready).toMatchObject({ run_id: READY, ready: true, blockers: [] });
    expect(notReady.run_id).toBe(NOT_READY);
    expect(notReady.ready).toBe(false);
    expect(notReady.blockers).not.toHaveLength(0);
  });

  it("publishes the run asked, where asked, as visible as asked", async () => {
    const other = RUNS.find((run) => run !== READY && MOCK_PUBLISH_READINESS[run].ready);
    if (!other) throw new Error("the demo needs a second run that is ready");

    const shown = await client.publish(other, {
      target: "huggingface",
      destination: "another-org/another-name",
      options: { private: false },
    });
    const hidden = await client.publish(other, {
      target: "huggingface",
      destination: "another-org/another-name",
      options: { private: true },
    });

    expect(shown).toMatchObject({
      run_id: other,
      destination: "another-org/another-name",
      reference: "https://huggingface.co/datasets/another-org/another-name",
      status: "published_public",
    });
    expect(hidden.status).toBe("published_private");
  });
});

describe("a run whose source terms allow non-commercial use only", () => {
  // No demo run has a redistribution verdict, so the demo is given one: without it
  // the confirmation below would be compared on a branch nothing reaches.
  const RUN = "non-commercial-run";
  const READINESS: Record<string, PublishReadinessResponse> = {
    [RUN]: {
      run_id: RUN,
      target: "huggingface",
      ready: true,
      blockers: [],
      warnings: [],
      redistribution: { verdict: "non_commercial", sources: [] },
    },
  };
  const withVerdict = createDemoPublishClient(READINESS);

  beforeEach(() => {
    served = withVerdict;
  });

  it.each([
    ["confirmed", true],
    ["not confirmed", false],
  ])("records the verdict and that it was %s, on both clients", async (_name, confirmed) => {
    const request = {
      target: "huggingface" as const,
      destination: DESTINATION,
      options: { confirm_non_commercial: confirmed },
    };

    const fromDemo = await withVerdict.publish(RUN, request);
    const fromReal = await realPublishClient.publish(RUN, request);

    expect(fromDemo.redistribution).toMatchObject({ verdict: "non_commercial", confirm_non_commercial: confirmed });
    expect(fromReal).toStrictEqual(JSON.parse(JSON.stringify(fromDemo)));
  });
});

describe("the demo", () => {
  it("hands out a copy of a readiness, not the fixture", async () => {
    const first = await demoPublishClient.readiness(NOT_READY, "huggingface");
    first.blockers.length = 0;
    first.ready = true;

    const second = await demoPublishClient.readiness(NOT_READY, "huggingface");
    expect(second.ready).toBe(false);
    expect(second.blockers).not.toHaveLength(0);
  });
});

describe("the credential", () => {
  it("goes to Builder in a header, and in neither the URL nor the body", async () => {
    await realPublishClient.publish(READY, { target: "huggingface", destination: DESTINATION }, undefined, CREDENTIAL);

    expect(JSON.stringify(lastRequest?.headers)).toContain(CREDENTIAL.HF_TOKEN);
    expect(lastRequest?.url.href).not.toContain(CREDENTIAL.HF_TOKEN);
    expect(lastRequest?.body).not.toContain(CREDENTIAL.HF_TOKEN);
  });

  it("is not looked at by the demo", async () => {
    const withIt = await demoPublishClient.publish(READY, { target: "huggingface", destination: DESTINATION }, undefined, CREDENTIAL);
    const without = await demoPublishClient.publish(READY, { target: "huggingface", destination: DESTINATION });

    expect(withIt).toEqual(without);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});

describe.each([
  ["the demo", "false", 0],
  ["a Builder holding the demo's data", "true", 1],
])("what the screens make of it: %s", (_name, useRealBuilder, requests) => {
  beforeEach(() => {
    window.__KPUBDATA_CONFIG__ = { useRealBuilder };
  });

  it("nothing to settle, where there is no receipt", async () => {
    expect(await reconcilePublish(READY, DESTINATION)).toEqual({ kind: "nothing_to_settle" });
    expect(globalThis.fetch).toHaveBeenCalledTimes(requests);
  });

  it("nothing to reset, where there is no receipt", async () => {
    expect(await resetPublishReceipt(READY, DESTINATION)).toEqual({ kind: "nothing_to_settle" });
    expect(globalThis.fetch).toHaveBeenCalledTimes(requests);
  });

  it("the same failure for a run that is not ready", async () => {
    const failure = await publishBuild(NOT_READY, { target: "huggingface", destination: DESTINATION }).then(
      () => undefined,
      describePublishFailure,
    );

    expect(failure?.kind).toBe("publish_conflict");
    expect(globalThis.fetch).toHaveBeenCalledTimes(requests);
  });
});
