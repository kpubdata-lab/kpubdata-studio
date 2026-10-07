import { describe, expect, it } from "vitest";

import { ApiError } from "./builderApi";
import { keysWereLost, missingProviderKeys } from "./missingProviderKey";

const REFUSED = { error: "this build calls datago", code: "provider_credential_required", providers: ["datago"] };

describe("missingProviderKeys (#787)", () => {
  it("reads the providers of a 400: keys travel with the request", () => {
    expect(missingProviderKeys(new ApiError(400, "refused", REFUSED))).toEqual({
      providers: ["datago"],
      keptIn: "request",
    });
  });

  it("reads a 403 as a deployment that stores keys", () => {
    expect(missingProviderKeys(new ApiError(403, "refused", REFUSED))?.keptIn).toBe("stored");
  });

  it("lower-cases the names and drops repeats and what is not a name", () => {
    const body = { ...REFUSED, providers: ["DataGo", "datago", " seoul ", "", 7, null] };

    expect(missingProviderKeys(new ApiError(400, "refused", body))?.providers).toEqual(["datago", "seoul"]);
  });

  it.each([
    ["another 400", new ApiError(400, "bad", { error: "'limit' must be a positive integer" })],
    ["another code", new ApiError(400, "bad", { code: "run_id_ended", providers: ["datago"] })],
    ["another 403", new ApiError(403, "no", { code: "signup_pending" })],
    ["the code on another status", new ApiError(502, "no", REFUSED)],
    ["no providers", new ApiError(400, "refused", { code: "provider_credential_required" })],
    ["an empty list", new ApiError(400, "refused", { ...REFUSED, providers: [] })],
    ["no body", new ApiError(400, "refused")],
    ["a body that is not an object", new ApiError(400, "refused", "provider_credential_required")],
    ["an ordinary error", new Error("provider_credential_required")],
    ["nothing", undefined],
  ])("is not this: %s", (_name, cause) => {
    expect(missingProviderKeys(cause)).toBeNull();
  });
});

describe("keysWereLost (#787)", () => {
  it("reads the job's code", () => {
    expect(keysWereLost({ status: "failed", code: "credentials_required", error: "anything" })).toBe(true);
  });

  it("reads the sentence of a Builder that sends no code", () => {
    expect(keysWereLost({ status: "failed", error: "credentials_required: the server restarted" })).toBe(true);
  });

  it.each([
    ["another failure", { status: "failed", error: "pipeline failed" }],
    ["a failure with no reason", { status: "failed" }],
    ["the words inside another sentence", { status: "failed", error: "note: credentials_required: x" }],
    ["a run that did not fail", { status: "succeeded", code: "credentials_required" }],
    ["a run still going", { status: "running", error: "credentials_required: x" }],
  ])("is not this: %s", (_name, job) => {
    expect(keysWereLost(job)).toBe(false);
  });
});
