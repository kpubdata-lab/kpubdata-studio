import { describe, expect, it, vi } from "vitest";

import type { BuildJob } from "@/shared/lib/builderApi";
import type { BuildSpec } from "@/shared/lib/types";
import { buildRunFromJob, generateRunId } from "./index";

describe("generateRunId", () => {
  /** What Builder accepts as a run id (`pipeline/context.py`): a safe path segment. */
  const BUILDER_SAFE = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;

  it("dataset id를 경로 안전한 슬러그로 정규화한다", () => {
    const runId = generateRunId("My Dataset/2024!");
    expect(runId).toMatch(/^my-dataset-2024-\d+-[a-z0-9]{5,}$/);
    expect(runId).toMatch(BUILDER_SAFE);
  });

  it("빈/비영숫자 dataset id는 'build' 기본값으로 대체한다", () => {
    const runId = generateRunId("!!!");
    expect(runId).toMatch(/^build-\d+-[a-z0-9]{5,}$/);
  });

  it("carries the time it was made, so the id still sorts and reads by when", () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-10-07T00:00:00.000Z"));
      expect(generateRunId("ds")).toMatch(new RegExp(`^ds-${Date.UTC(2026, 9, 7)}-[a-z0-9]{5,}$`));
    } finally {
      vi.useRealTimers();
    }
  });

  it("makes different ids in the same millisecond (#815)", () => {
    // The clock does not move: the time cannot be what tells the ids apart.
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-10-07T00:00:00.000Z"));
      const ids = Array.from({ length: 2000 }, () => generateRunId("ds"));

      expect(new Set(ids).size).toBe(ids.length);
      expect(new Set(ids.map((id) => id.split("-")[1])).size).toBe(1);
      for (const id of ids) expect(id).toMatch(BUILDER_SAFE);
    } finally {
      vi.useRealTimers();
    }
  });

  it("differs in the same millisecond even when the random part repeats", () => {
    // The count alone keeps one tab's ids apart; the random part is for other tabs.
    vi.useFakeTimers();
    const random = vi.spyOn(globalThis.crypto, "getRandomValues").mockImplementation((values) => values);
    try {
      vi.setSystemTime(new Date("2026-10-07T00:00:00.000Z"));
      const ids = Array.from({ length: 200 }, () => generateRunId("ds"));

      expect(new Set(ids).size).toBe(ids.length);
    } finally {
      random.mockRestore();
      vi.useRealTimers();
    }
  });

  it("keeps a long dataset name from making an unbounded id", () => {
    const runId = generateRunId("x".repeat(500));

    expect(runId.split("-")[0]).toHaveLength(40);
    expect(runId.length).toBeLessThan(80);
  });
});

describe("buildRunFromJob (#603)", () => {
  const spec = { dataset_id: "air" } as unknown as BuildSpec;
  const job = (overrides: Partial<BuildJob>): BuildJob => ({
    run_id: "run-1",
    status: "succeeded",
    created_at: "2026-10-01T00:00:00+00:00",
    updated_at: "2026-10-01T00:00:05+00:00",
    ...overrides,
  });
  const run = (overrides: Partial<BuildJob>) => buildRunFromJob(job(overrides), spec, "start");

  it("shows the reason of a job that failed before a build body existed", () => {
    const result = run({
      status: "failed",
      response: { error: "provider client unavailable" },
      error: "provider client unavailable",
    });
    expect(result).toMatchObject({ status: "failed", error: "provider client unavailable" });
  });

  it("marks a run that failed because its keys were gone, by code or by sentence (#787)", () => {
    const lost = "credentials_required: the server restarted and the job's provider keys are gone";

    expect(run({ status: "failed", error: lost, code: "credentials_required" })).toMatchObject({ keysLost: true, error: lost });
    expect(run({ status: "failed", error: lost }).keysLost).toBe(true);
    // Any other failure, and a run that did not fail, are not that.
    expect(run({ status: "failed", error: "pipeline failed" }).keysLost).toBeUndefined();
    expect(run({ status: "succeeded", code: "credentials_required" }).keysLost).toBeUndefined();
  });

  it("marks it too when the reason is only in the job's response (#849)", () => {
    const inResponse = run({ status: "failed", response: { status: "failed", code: "credentials_required" } });
    expect(inResponse.keysLost).toBe(true);
    expect(inResponse.status).toBe("failed");
    // The job's own reason comes first: another one there is not overruled.
    expect(run({ status: "failed", code: "build_timeout", response: { code: "credentials_required" } }).keysLost).toBeUndefined();
  });

  it("falls back to the response's error, then a default, when the job has none", () => {
    expect(run({ status: "failed", response: { error: "from body" } }).error).toBe("from body");
    expect(run({ status: "failed", response: { error: 42 } }).error).toBe("실행 잡이 실패했습니다.");
  });

  it("keeps a minimal, null or absent response succeeded", () => {
    expect(run({ response: { run_id: "run-1", status: "ok" } }).status).toBe("succeeded");
    expect(run({ response: null }).status).toBe("succeeded");
    expect(run({}).status).toBe("succeeded");
    // A body of an unexpected shape does not turn a succeeded job into a failure or crash.
    expect(run({ response: { outcomes: "not a list" } }).status).toBe("succeeded");
  });

  it("reports a partial failure in a succeeded job's body, top error before outcome error", () => {
    const outcomes = [{ source_key: "a", error: null }, { source_key: "b", error: "b broke" }];
    expect(run({ response: { status: "failed", outcomes } })).toMatchObject({ status: "failed", error: "b broke" });
    expect(run({ response: { status: "failed", error: "top", outcomes } }).error).toBe("top");
    expect(run({ response: { status: "failed" } }).error).toBe("일부 소스 처리가 실패했습니다.");
  });

  it("keeps a cancelled job cancelled", () => {
    expect(run({ status: "cancelled", response: { error: "x" } }).status).toBe("cancelled");
  });
});
