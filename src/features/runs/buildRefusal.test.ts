// @vitest-environment jsdom
/**
 * A build turned away for want of room is said in the user's language (#859).
 *
 * Builder answers 429 `build_owner_limit` when a user already has their share of builds
 * queued or running (contract 1.111.0), and 429 `build_queue_full` when the server has no
 * room at all. Both reached the user as Builder's English sentence.
 */
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import EN from "@/shared/i18n/locales/en.json";
import { ApiError, resetAuthRenewalForTests } from "@/shared/lib/builderApi";
import { clearSessionRefusal } from "@/shared/lib/sessionRefusal";
import type { BuildSpec } from "@/shared/lib/types";
import { buildRefusal, buildRefusalMessage } from "./buildRefusal";
import { useBuildJob } from "./useBuildJob";

const OWNER_LIMIT = {
  error: "you already have 2 builds queued or running; submit this one when one of them has finished",
  code: "build_owner_limit",
  limit: 2,
};
const QUEUE_FULL = { error: "async build queue is full", code: "build_queue_full" };
const DISK_LOW = { error: "the server is low on disk space and is not accepting builds; submit the build again later", code: "disk_space_low" };
const STORAGE_QUOTA = {
  error: "your runs use the storage one user may keep; submit this build when older runs have expired",
  code: "run_storage_quota_exceeded",
  limit_bytes: 10737418240,
  used_bytes: 10737418240,
};

describe("buildRefusal", () => {
  it("reads the per-user limit and how many it is", () => {
    expect(buildRefusal(new ApiError(429, "x", OWNER_LIMIT))).toStrictEqual({ code: "build_owner_limit", limit: 2 });
    // The number sent decides, not Builder's sentence.
    expect(buildRefusal(new ApiError(429, "x", { ...OWNER_LIMIT, limit: 7 }))).toStrictEqual({ code: "build_owner_limit", limit: 7 });
  });

  it.each([undefined, null, "2", 0, -1, 1.5])("reads the limit %j as not said", (limit) => {
    expect(buildRefusal(new ApiError(429, "x", { ...OWNER_LIMIT, limit }))).toStrictEqual({ code: "build_owner_limit", limit: null });
  });

  it("reads a full queue", () => {
    expect(buildRefusal(new ApiError(429, "x", QUEUE_FULL))).toStrictEqual({ code: "build_queue_full" });
    expect(buildRefusal(new ApiError(429, "x", { ...QUEUE_FULL, future_optional_field: "later" }))).toStrictEqual({ code: "build_queue_full" });
  });

  it("reads a disk-space refusal on 503 and a storage-quota refusal on 409 (contract 1.118.0)", () => {
    expect(buildRefusal(new ApiError(503, "x", DISK_LOW))).toStrictEqual({ code: "disk_space_low" });
    expect(buildRefusal(new ApiError(409, "x", STORAGE_QUOTA))).toStrictEqual({
      code: "run_storage_quota_exceeded",
      limitBytes: 10737418240,
      usedBytes: 10737418240,
    });
  });

  it.each([undefined, null, "5", -1, 1.5])("reads the size %j as not said", (size) => {
    expect(buildRefusal(new ApiError(409, "x", { ...STORAGE_QUOTA, limit_bytes: size, used_bytes: size }))).toStrictEqual({
      code: "run_storage_quota_exceeded",
      limitBytes: null,
      usedBytes: null,
    });
  });

  it.each([
    ["the disk code on 429", new ApiError(429, "x", DISK_LOW)],
    ["the quota code on 503", new ApiError(503, "x", STORAGE_QUOTA)],
    ["a 503 with another code", new ApiError(503, "x", { error: "down", code: "shutting_down" })],
    ["a 409 with another code", new ApiError(409, "x", { error: "busy", code: "retry_of_in_progress" })],
    ["a 409 with no body", new ApiError(409, "x")],
  ])("does not take %s for one", (_what, cause) => {
    expect(buildRefusal(cause)).toBeNull();
  });

  it("says them in the user's language, with sizes in readable units", () => {
    expect(buildRefusalMessage({ code: "disk_space_low" })).toBe("서버의 디스크 여유 공간이 부족해 실행을 받지 않고 있습니다. 잠시 후 다시 시도하세요.");
    expect(EN.runs.build.diskSpaceLow).toBe("The server is low on disk space and is not accepting runs. Try again later.");
    expect(buildRefusalMessage({ code: "run_storage_quota_exceeded", limitBytes: 10737418240, usedBytes: 9663676416 })).toBe(
      "내 실행이 한 사용자가 보관할 수 있는 10 GiB 중 9 GiB를 사용하고 있습니다. 오래된 실행은 보관 기간이 지나면 지워집니다. 그 뒤에 다시 시도하세요.",
    );
    expect(buildRefusalMessage({ code: "run_storage_quota_exceeded", limitBytes: 1536, usedBytes: 700 })).toContain("1.5 KiB 중 700 B");
    expect(buildRefusalMessage({ code: "run_storage_quota_exceeded", limitBytes: null, usedBytes: null })).toContain("저장 공간을 모두 사용");
    expect(EN.runs.build.storageQuota).toContain("Older runs are removed when they expire");
  });

  it.each([
    ["another 429", new ApiError(429, "x", { error: "slow down", code: "auth_throttled" })],
    ["a 429 with no code", new ApiError(429, "x", { error: "busy" })],
    ["the code on another status", new ApiError(400, "x", OWNER_LIMIT)],
    ["a 429 with no body", new ApiError(429, "x")],
    ["a 429 whose body is a list", new ApiError(429, "x", [OWNER_LIMIT])],
    ["something that is not Builder's answer", new TypeError("network down")],
  ])("does not take %s for one", (_what, cause) => {
    expect(buildRefusal(cause)).toBeNull();
  });

  it("says each in the user's language, with the limit when there is one", () => {
    expect(buildRefusalMessage({ code: "build_owner_limit", limit: 2 })).toBe(
      "이미 실행 2개가 대기 중이거나 진행 중입니다. 그중 하나가 끝난 뒤 다시 시도하세요.",
    );
    expect(buildRefusalMessage({ code: "build_owner_limit", limit: 7 })).toContain("실행 7개");
    // One is one run, in English too: not "1 runs".
    expect(buildRefusalMessage({ code: "build_owner_limit", limit: 1 })).toBe(
      "이미 실행 1개가 대기 중이거나 진행 중입니다. 그것이 끝난 뒤 다시 시도하세요.",
    );
    expect(EN.runs.build.ownerLimitOne).toBe("You already have 1 run queued or running. Try again when it has finished.");
    expect(EN.runs.build.ownerLimit).toContain("{{limit}} runs");
    expect(buildRefusalMessage({ code: "build_owner_limit", limit: null })).toContain("동시에 둘 수 있는 실행 수");
    expect(buildRefusalMessage({ code: "build_queue_full" })).toBe("서버의 실행 대기열이 가득 찼습니다. 잠시 후 다시 시도하세요.");
  });
});

const SPEC: BuildSpec = {
  datasetId: "air-quality",
  title: "Air quality",
  description: "Hourly air quality by region",
  sources: [{ provider: "datago", dataset: "air_quality", params: {} }],
  exports: [{ format: "jsonl" }],
  metadata: {},
};

/** A Builder that answers every build submission with `status` and `body`. */
function builderThatRefuses(status: number, body: unknown) {
  vi.spyOn(globalThis, "fetch").mockImplementation(
    async () => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }),
  );
}

describe("useBuildJob", () => {
  beforeEach(() => {
    clearSessionRefusal();
    resetAuthRenewalForTests();
    window.__KPUBDATA_CONFIG__ = { useRealBuilder: "true" };
  });

  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
    delete window.__KPUBDATA_CONFIG__;
  });

  async function refusedWith(status: number, body: unknown): Promise<string | undefined> {
    builderThatRefuses(status, body);
    const { result } = renderHook(() => useBuildJob());
    await act(async () => {
      await result.current.start(SPEC);
    });
    await waitFor(() => expect(result.current.status).toBe("failed"));
    return result.current.error;
  }

  it("tells a user at their limit so, with the limit, not Builder's sentence", async () => {
    const error = await refusedWith(429, OWNER_LIMIT);

    expect(error).toBe("이미 실행 2개가 대기 중이거나 진행 중입니다. 그중 하나가 끝난 뒤 다시 시도하세요.");
    expect(error).not.toContain("you already have");
  });

  it("tells a user the server's queue is full", async () => {
    expect(await refusedWith(429, QUEUE_FULL)).toBe("서버의 실행 대기열이 가득 찼습니다. 잠시 후 다시 시도하세요.");
  });

  it("tells a user the server is low on disk space", async () => {
    expect(await refusedWith(503, DISK_LOW)).toContain("디스크 여유 공간이 부족");
  });

  it("tells a user their runs fill the storage they may keep, with the sizes", async () => {
    const error = await refusedWith(409, STORAGE_QUOTA);

    expect(error).toContain("10 GiB 중 10 GiB");
    expect(error).not.toContain("your runs use");
  });

  it("still shows any other refusal as Builder wrote it", async () => {
    expect(await refusedWith(400, { error: "invalid spec: sources must contain at least one source" })).toBe(
      "invalid spec: sources must contain at least one source",
    );
  });
});
