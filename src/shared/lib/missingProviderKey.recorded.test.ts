/**
 * The two answers of Builder that mean "a provider key is missing", as Builder sent them
 * (#787, V2).
 *
 * `missingProviderKey.test.ts` feeds the readers bodies written by hand. These are
 * recordings (`__recordings__/missingProviderKey.json` says where each came from), played
 * back through the client the screens use, so the whole path is checked: the status and
 * body reach an `ApiError`, the job passes the schema, and the readers understand both.
 * The multi-user real-Builder e2e compares what Builder answers there with the same file,
 * so a Builder that changes these answers fails that run before this test can go stale.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import recorded from "./__recordings__/missingProviderKey.json";
import { ApiError, builderApi } from "./builderApi";
import { keysWereLost, missingProviderKeys } from "./missingProviderKey";

const SPEC = JSON.stringify({ dataset_id: "datago-air-station", sources: [{ provider: "datago", dataset: "air_station" }] });

const CALLS: Record<string, () => Promise<unknown>> = {
  preview: () => builderApi.preview(SPEC),
  submitBuild: () => builderApi.submitBuild(SPEC),
  build: () => builderApi.build(SPEC),
};

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

let fetchMock: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  fetchMock = vi.spyOn(globalThis, "fetch");
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Builder's recorded refusals for a missing key (#787)", () => {
  it.each(recorded.refusals)("$name", async (refusal) => {
    fetchMock.mockImplementation(async () => json(refusal.status, refusal.body));

    const cause = await CALLS[refusal.call]!().then(
      () => null,
      (error: unknown) => error,
    );

    expect(cause).toBeInstanceOf(ApiError);
    expect(missingProviderKeys(cause)).toEqual({ providers: ["datago"], keptIn: refusal.keptIn });
    // Refused before any provider was called: asked once, never sent again by itself.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("covers both statuses Builder refuses with", () => {
    expect([...new Set(recorded.refusals.map((refusal) => refusal.status))].sort()).toEqual([400, 403]);
  });
});

describe("Builder's recorded job that lost its keys (#787)", () => {
  it("passes the job schema and is read as keys lost", async () => {
    fetchMock.mockImplementation(async () => json(200, recorded.keysLostJob));

    const job = await builderApi.getBuildJob(recorded.keysLostJob.run_id);

    expect(job.status).toBe("failed");
    expect(job.code).toBe("credentials_required");
    expect(keysWereLost(job)).toBe(true);
  });

  it("is still read as keys lost by a client that only has the sentence", () => {
    const { code: _code, response: _response, ...older } = recorded.keysLostJob;

    expect(keysWereLost(older)).toBe(true);
  });
});
