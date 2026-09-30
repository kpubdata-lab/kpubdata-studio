import { describe, expect, it } from "vitest";

import type { BuildJob } from "@/shared/lib/builderApi";
import type { BuildSpec } from "@/shared/lib/types";
import { buildRunFromJob, generateRunId } from "./index";

describe("generateRunId", () => {
  it("dataset id를 경로 안전한 슬러그로 정규화한다", () => {
    const runId = generateRunId("My Dataset/2024!");
    expect(runId).toMatch(/^my-dataset-2024-\d+$/);
  });

  it("빈/비영숫자 dataset id는 'build' 기본값으로 대체한다", () => {
    const runId = generateRunId("!!!");
    expect(runId).toMatch(/^build-\d+$/);
  });

  it("호출마다 서로 다른 값을 생성한다", async () => {
    const first = generateRunId("ds");
    await new Promise((resolve) => setTimeout(resolve, 2));
    const second = generateRunId("ds");
    expect(first).not.toBe(second);
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
