/**
 * One contract, two clients — publish (#794).
 *
 * As `features/datasets/api/client.contract.test.ts`: the real client is pointed at a
 * Builder that answers with the demo's own data, sent as JSON and read back through
 * Builder's response schemas. Publishing is also refused in places, so the refusals are
 * compared too: the status, and the `code` the screens branch on.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError, resetAuthRenewalForTests } from "@/shared/lib/builderApi";
import { clearSessionRefusal } from "@/shared/lib/sessionRefusal";
import { demoPublishClient, realPublishClient, type PublishClient } from "./client";
import { describePublishFailure, publishBuild, reconcilePublish, resetPublishReceipt } from "./index";
import { MOCK_PUBLISH_READINESS } from "./mockData";

const RUNS = Object.keys(MOCK_PUBLISH_READINESS);
const READY = RUNS.find((run) => MOCK_PUBLISH_READINESS[run].ready && MOCK_PUBLISH_READINESS[run].blockers.length === 0)!;
const NOT_READY = RUNS.find((run) => !MOCK_PUBLISH_READINESS[run].ready || MOCK_PUBLISH_READINESS[run].blockers.length > 0)!;
const DESTINATION = "kpubdata/air-quality";
const CREDENTIAL = { HF_TOKEN: "hf_not_a_real_token" };

/** What the Builder below was last sent. */
let lastRequest: { method: string; url: URL; headers: Record<string, string>; body: string | undefined } | undefined;

/** A Builder that holds exactly what the demo holds. */
async function demoBuilder(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const signal = init?.signal ?? undefined;
  if (signal?.aborted) throw signal.reason ?? new DOMException("Aborted", "AbortError");
  const url = new URL(String(input), "http://builder.test");
  const method = init?.method ?? "GET";
  const body = typeof init?.body === "string" ? init.body : undefined;
  lastRequest = { method, url, headers: { ...(init?.headers as Record<string, string>) }, body };
  const route = /\/builds\/([^/]+)\/publish(\/readiness|\/reconcile|\/receipt)?$/.exec(url.pathname);
  if (!route) throw new Error(`the demo Builder has no route for ${method} ${url.pathname}`);
  const runId = decodeURIComponent(route[1]);
  try {
    if (route[2] === "/readiness") return json(200, await demoPublishClient.readiness(runId, "huggingface"));
    if (route[2] === "/reconcile") return json(200, await demoPublishClient.reconcile(runId, JSON.parse(body ?? "{}")));
    if (route[2] === "/receipt") {
      return json(200, await demoPublishClient.resetReceipt(runId, "huggingface", url.searchParams.get("destination") ?? ""));
    }
    return json(200, await demoPublishClient.publish(runId, JSON.parse(body ?? "{}")));
  } catch (error) {
    if (!(error instanceof ApiError)) throw error;
    return json(error.status, { error: error.message, ...(error.details as object | undefined) });
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
    ["non-commercial confirmed", { private: true, confirm_non_commercial: true }],
  ])("a publish, %s", async (_name, options) => {
    const request = { target: "huggingface" as const, destination: DESTINATION, options };
    const fromDemo = await demoPublishClient.publish(READY, request);
    const fromReal = await realPublishClient.publish(READY, request);

    expect(fromReal).toStrictEqual(JSON.parse(JSON.stringify(fromDemo)));
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });
});

describe.each(CLIENTS)("the %s client", (_name, client) => {
  it.each(REFUSALS)("refuses %s", async (_what, call, status, code) => {
    const refusal = await call(client).then(
      () => undefined,
      (error: unknown) => error,
    );

    expect(refusal).toBeInstanceOf(ApiError);
    expect((refusal as ApiError).status).toBe(status);
    expect(((refusal as ApiError).details as { code?: string } | undefined)?.code).toBe(code);
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
