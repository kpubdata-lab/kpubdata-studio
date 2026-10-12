/**
 * One job contract, two clients (#794, #902).
 *
 * `RunsClient` mirrors Builder's job surface, so submitting, polling and cancelling take
 * one path in both modes. Here the same expectations run over both implementations. The
 * real client is pointed at a Builder that answers from the demo's own job model, sent
 * as JSON and read back through the job schema of Builder's contract, so a demo job that
 * Builder's contract would not allow fails here.
 *
 * `list` and `getRun` answer in Studio's model and `getSpec`/`getEvents` are refused by the
 * demo; `client.ts` says why. They are not part of this contract.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError, resetAuthRenewalForTests, type BuildJob } from "@/shared/lib/builderApi";
import { clearSessionRefusal } from "@/shared/lib/sessionRefusal";
import { demoRunsClient, realRunsClient, resetDemoJobsForTests, type RunsClient } from "./client";

const SPEC = "dataset_id: contract\ntitle: Contract\nsources: []\nexports: []\n";

/** A Builder whose job registry is the demo's. */
async function demoBuilder(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const signal = init?.signal ?? undefined;
  if (signal?.aborted) throw signal.reason ?? new DOMException("Aborted", "AbortError");
  const url = new URL(String(input), "http://builder.test");
  const parts = url.pathname
    .replace(/^.*?(?=\/builds(\/|$))/, "")
    .split("/")
    .filter(Boolean)
    .map(decodeURIComponent);
  const method = init?.method ?? "GET";
  try {
    const [head, runId, action] = parts;
    if (head !== "builds") throw new Error(`the demo Builder has no route for ${url.pathname}`);
    if (method === "POST" && parts.length === 1) {
      const body = JSON.parse(String(init?.body)) as { spec: string; run_id: string; retry_of?: string };
      return json(202, await demoRunsClient.submit(body.spec, body.run_id, undefined, body.retry_of));
    }
    if (method === "GET" && parts.length === 2) return json(200, await demoRunsClient.getJob(runId));
    if (method === "POST" && action === "cancel") return json(202, await demoRunsClient.cancel(runId));
    throw new Error(`the demo Builder has no route for ${method} ${url.pathname}`);
  } catch (error) {
    if (error instanceof ApiError) return json(error.status, { error: error.message });
    throw error;
  }
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

const CLIENTS: Array<[name: string, client: RunsClient]> = [
  ["demo", demoRunsClient],
  ["real", realRunsClient],
];

let issued = 0;
/** A run id no other case has used. */
function runId(): string {
  issued += 1;
  return `contract-${issued}`;
}

async function statusOf(promise: Promise<unknown>): Promise<number | undefined> {
  try {
    await promise;
    return undefined;
  } catch (error) {
    return error instanceof ApiError ? error.status : -1;
  }
}

beforeEach(() => {
  clearSessionRefusal();
  resetAuthRenewalForTests();
  resetDemoJobsForTests();
  vi.spyOn(globalThis, "fetch").mockImplementation(demoBuilder);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe.each(CLIENTS)("the %s runs client", (_name, client) => {
  it("accepts a job as queued under the run id asked for, and polls it to an end", async () => {
    const id = runId();
    const submitted = await client.submit(SPEC, id);

    expect(submitted).toMatchObject({ run_id: id, status: "queued" });
    const seen: BuildJob["status"][] = [];
    for (let poll = 0; poll < 3; poll++) seen.push((await client.getJob(id)).status);
    expect(seen).toEqual(["running", "succeeded", "succeeded"]);
  });

  it("answers a run id it already has with that job, not a new one", async () => {
    const id = runId();
    await client.submit(SPEC, id);
    await client.getJob(id);

    expect((await client.submit(SPEC, id)).status).toBe("running");
  });

  it("keeps the earlier run a retry names", async () => {
    expect((await client.submit(SPEC, runId(), undefined, "earlier-run")).retry_of).toBe("earlier-run");
  });

  it("cancels a queued job at once", async () => {
    const id = runId();
    await client.submit(SPEC, id);

    expect((await client.cancel(id)).status).toBe("cancelled");
    expect((await client.getJob(id)).status).toBe("cancelled");
  });

  it("cancels a running job cooperatively: cancelling, then cancelled", async () => {
    const id = runId();
    await client.submit(SPEC, id);
    await client.getJob(id);

    expect((await client.cancel(id)).status).toBe("cancelling");
    expect((await client.getJob(id)).status).toBe("cancelled");
  });

  it("refuses to cancel a job that has ended (409), and a run it does not know (404)", async () => {
    const id = runId();
    await client.submit(SPEC, id);
    await client.getJob(id);
    await client.getJob(id);

    expect(await statusOf(client.cancel(id))).toBe(409);
    expect(await statusOf(client.cancel("no-such-run"))).toBe(404);
  });

  it("answers 404 for a run its registry does not have", async () => {
    expect(await statusOf(client.getJob("no-such-run"))).toBe(404);
  });

  it("refuses an aborted request without answering it, and submits nothing", async () => {
    const id = runId();
    const controller = new AbortController();
    controller.abort();

    await expect(client.submit(SPEC, id, controller.signal)).rejects.toThrow();
    await expect(client.getJob(id, controller.signal)).rejects.toThrow();
    expect(await statusOf(client.getJob(id))).toBe(404);
  });
});

describe("the two clients give the same answer", () => {
  it("a job read through Builder's job schema is the demo's job unchanged", async () => {
    await realRunsClient.submit(SPEC, "same-answer", undefined, "earlier-run");
    await realRunsClient.getJob("same-answer");
    await realRunsClient.getJob("same-answer");

    // The fake Builder keeps its jobs in the demo's registry, and a job that has ended
    // stays as it is, so both read the same job.
    const fromDemo = await demoRunsClient.getJob("same-answer");
    const fromReal = await realRunsClient.getJob("same-answer");

    expect(fromDemo.status).toBe("succeeded");
    expect(fromReal).toStrictEqual(JSON.parse(JSON.stringify(fromDemo)));
  });
});
