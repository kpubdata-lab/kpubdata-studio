/**
 * Builds/Runs master-detail (#255) model-helper tests.
 *
 * Verifies only real Builder contract values are used (StageStatusValue:
 * completed/failed/not_run/unavailable; BuildJob status:
 * queued/running/cancelling/succeeded/failed/cancelled) and that Studio
 * never invents whole-run states like "partial".
 */
import { describe, expect, it } from "vitest";
import { ApiError } from "@/shared/lib/builderApi";
import type { BuildEvent, BuildQualityResponse, RunStageEntry } from "@/shared/lib/builderApi";
import type { BuildListItem } from "@/shared/lib/types";
import {
  GLOBAL_RUN_EVENT_SOURCE_KEY,
  classifyRunApiError,
  collectFailureEvidence,
  computeBuildKpi,
  failQualityResults,
  failedRunEvents,
  firstFailedStage,
  groupRunEventsBySource,
  lastCompletedStage,
  lastOkRunEvent,
  matchesSearch,
  matchesStatusFilter,
  summarizeEventMetrics,
  summarizeMultiSourceOutcome,
} from "./model";

function runEvent(overrides: Partial<BuildEvent> = {}): BuildEvent {
  return {
    seq: 1,
    timestamp: "2026-08-01T00:00:00Z",
    run_id: "run-1",
    event: "stage_started",
    status: "ok",
    source_key: "air",
    stage: "bronze",
    message: null,
    metrics: null,
    ...overrides,
  };
}

function stageEntry(overrides: Partial<RunStageEntry> = {}): RunStageEntry {
  return {
    source_key: "air",
    bronze: { status: "completed", available: true },
    silver: { status: "completed", available: true },
    gold: { status: "completed", available: true },
    ...overrides,
  };
}

function listItem(overrides: Partial<BuildListItem> = {}): BuildListItem {
  return {
    id: "run-1",
    title: null,
    status: "succeeded",
    startedAt: "2026-08-01T00:00:00Z",
    finishedAt: "2026-08-01T00:05:00Z",
    ...overrides,
  };
}

describe("computeBuildKpi", () => {
  it("counts only within the loaded scope and exposes that scope explicitly", () => {
    const items = [
      listItem({ id: "a", status: "succeeded" }),
      listItem({ id: "b", status: "failed" }),
      listItem({ id: "c", status: "cancelled" }),
      listItem({ id: "d", status: "queued" }),
      listItem({ id: "e", status: "running" }),
    ];
    const kpi = computeBuildKpi(items, 50, true);
    expect(kpi).toEqual({
      scopeCount: 5,
      scopeLimit: 50,
      succeeded: 1,
      failed: 1,
      cancelled: 1,
      running: 2,
      runningOnly: 1,
      queuedOnly: 1,
      cancellingOnly: 0,
      runningAvailable: true,
    });
  });

  it("breaks the running total down by exact status (running/queued/cancelling) without guessing", () => {
    const items = [
      listItem({ id: "a", status: "running" }),
      listItem({ id: "b", status: "queued" }),
      listItem({ id: "c", status: "queued" }),
      listItem({ id: "d", status: "cancelling" }),
    ];
    const kpi = computeBuildKpi(items, 50, true);
    expect(kpi.running).toBe(4);
    expect(kpi.runningOnly).toBe(1);
    expect(kpi.queuedOnly).toBe(2);
    expect(kpi.cancellingOnly).toBe(1);
  });

  it("does not fabricate a 0 running count when the scope cannot express it", () => {
    // Builder GET /builds only ever returns completed(ok/failed) history — running is
    // never derivable from it in real mode. runningAvailable=false must be preserved
    // so the UI shows N/A instead of a fake 0.
    const kpi = computeBuildKpi([listItem({ status: "succeeded" })], 50, false);
    expect(kpi.runningAvailable).toBe(false);
    expect(kpi.running).toBe(0); // The computed value is 0, but the UI must decide N/A display via runningAvailable.
  });
});

describe("matchesStatusFilter / matchesSearch", () => {
  it("filters by exact BuildRunStatus", () => {
    expect(matchesStatusFilter(listItem({ status: "failed" }), "failed")).toBe(true);
    expect(matchesStatusFilter(listItem({ status: "failed" }), "succeeded")).toBe(false);
    expect(matchesStatusFilter(listItem({ status: "failed" }), "all")).toBe(true);
  });

  it("matches search against title or id, case-insensitively", () => {
    const item = listItem({ id: "air-quality-20260815", title: "서울 대기질" });
    expect(matchesSearch(item, "AIR-QUALITY")).toBe(true);
    expect(matchesSearch(item, "대기질")).toBe(true);
    expect(matchesSearch(item, "population")).toBe(false);
    expect(matchesSearch(item, "")).toBe(true);
  });
});

describe("stage helpers — never collapse run status into stage status", () => {
  it("firstFailedStage only reports an actually-failed stage, not not_run", () => {
    const source = stageEntry({
      bronze: { status: "completed", available: true },
      silver: { status: "failed", available: false },
      gold: { status: "not_run", available: false },
    });
    expect(firstFailedStage(source)).toBe("silver");
    expect(lastCompletedStage(source)).toBe("bronze");
  });

  it("returns null (not a guess) when nothing failed or completed", () => {
    const source = stageEntry({
      bronze: { status: "not_run", available: false },
      silver: { status: "not_run", available: false },
      gold: { status: "not_run", available: false },
    });
    expect(firstFailedStage(source)).toBeNull();
    expect(lastCompletedStage(source)).toBeNull();
  });

  it("collectFailureEvidence pairs the failed stage with the last completed stage per source", () => {
    const sources = [
      stageEntry({ source_key: "air", bronze: { status: "completed", available: true }, silver: { status: "failed", available: false }, gold: { status: "not_run", available: false } }),
      stageEntry({ source_key: "population" }), // All completed — no failures
    ];
    expect(collectFailureEvidence(sources)).toEqual([
      { sourceKey: "air", failedStage: "silver", lastCompletedStage: "bronze" },
    ]);
  });
});

describe("summarizeMultiSourceOutcome — partial is a UI-only summary over sources, not a Builder run status", () => {
  it("all_succeeded when no source failed", () => {
    expect(summarizeMultiSourceOutcome([stageEntry({ source_key: "a" }), stageEntry({ source_key: "b" })])).toBe(
      "all_succeeded",
    );
  });

  it("partial when only some sources failed", () => {
    const sources = [
      stageEntry({ source_key: "a" }),
      stageEntry({ source_key: "b", silver: { status: "failed", available: false } }),
    ];
    expect(summarizeMultiSourceOutcome(sources)).toBe("partial");
  });

  it("all_failed when every source failed", () => {
    const sources = [
      stageEntry({ source_key: "a", bronze: { status: "failed", available: false } }),
      stageEntry({ source_key: "b", silver: { status: "failed", available: false } }),
    ];
    expect(summarizeMultiSourceOutcome(sources)).toBe("all_failed");
  });

  it("unavailable when there are no sources at all", () => {
    expect(summarizeMultiSourceOutcome([])).toBe("unavailable");
  });
});

describe("classifyRunApiError (#255 P0 permission state)", () => {
  it("classifies HTTP 403 as permission_denied, distinct from 404", () => {
    expect(classifyRunApiError(new ApiError(403, "forbidden"))).toBe("permission_denied");
    expect(classifyRunApiError(new ApiError(404, "not found"))).toBe("not_found");
  });

  it("does not guess permission from network/5xx or non-ApiError causes", () => {
    expect(classifyRunApiError(new ApiError(500, "boom"))).toBe("error");
    expect(classifyRunApiError(new Error("network"))).toBe("error");
    expect(classifyRunApiError("not an error")).toBe("error");
  });
});

describe("failQualityResults", () => {
  it("returns only status=fail results across all sources", () => {
    const quality: BuildQualityResponse = {
      run_id: "run-1",
      availability: "available",
      evaluated_checks: 3,
      quality_results: {
        air: [
          { source_key: "air", category: "row_count", rule: "min_rows", column: null, status: "pass", actual: 10, threshold: 5, affected_rows: null, evaluated_rows: null, detail: null },
          { source_key: "air", category: "missing", rule: "max_null_ratio", column: "value", status: "fail", actual: 0.5, threshold: 0.1, affected_rows: 5, evaluated_rows: 10, detail: null },
        ],
      },
      schema_drift: {},
    };
    const fails = failQualityResults(quality);
    expect(fails).toHaveLength(1);
    expect(fails[0].rule).toBe("max_null_ratio");
  });

  it("returns an empty array (not PASS) for null/undefined quality", () => {
    expect(failQualityResults(null)).toEqual([]);
    expect(failQualityResults(undefined)).toEqual([]);
  });
});

describe("structured run event helpers (#496 evidence, #255 P1)", () => {
  it("failedRunEvents keeps only status=fail events, in original order", () => {
    const events = [
      runEvent({ seq: 1, status: "ok" }),
      runEvent({ seq: 2, status: "fail", event: "stage_failed" }),
      runEvent({ seq: 3, status: "ok" }),
      runEvent({ seq: 4, status: "fail", event: "source_fetch_failed" }),
    ];
    expect(failedRunEvents(events).map((e) => e.seq)).toEqual([2, 4]);
  });

  it("lastOkRunEvent returns the last ok event in a chronological-ascending list, not the last event overall", () => {
    const events = [
      runEvent({ seq: 1, status: "ok" }),
      runEvent({ seq: 2, status: "ok" }),
      runEvent({ seq: 3, status: "fail" }),
    ];
    expect(lastOkRunEvent(events)?.seq).toBe(2);
  });

  it("lastOkRunEvent returns null (not a guess) when no event is ok", () => {
    expect(lastOkRunEvent([runEvent({ status: "fail" }), runEvent({ status: "warn" })])).toBeNull();
    expect(lastOkRunEvent([])).toBeNull();
  });

  it("groupRunEventsBySource keeps multi-source events separate instead of collapsing into the first source", () => {
    const events = [
      runEvent({ seq: 1, source_key: "air" }),
      runEvent({ seq: 2, source_key: "population" }),
      runEvent({ seq: 3, source_key: "air" }),
      runEvent({ seq: 4, source_key: null, event: "run_started" }),
    ];
    const grouped = groupRunEventsBySource(events);
    expect(Array.from(grouped.keys()).sort()).toEqual(["air", "population", GLOBAL_RUN_EVENT_SOURCE_KEY].sort());
    expect(grouped.get("air")?.map((e) => e.seq)).toEqual([1, 3]);
    expect(grouped.get("population")?.map((e) => e.seq)).toEqual([2]);
    expect(grouped.get(GLOBAL_RUN_EVENT_SOURCE_KEY)?.map((e) => e.seq)).toEqual([4]);
  });

  it("summarizeEventMetrics returns null (not an empty string) when metrics is null/empty", () => {
    expect(summarizeEventMetrics(null)).toBeNull();
    expect(summarizeEventMetrics({})).toBeNull();
  });

  it("summarizeEventMetrics renders a compact key=value summary from real fields only", () => {
    expect(summarizeEventMetrics({ row_count: 120, null_ratio: 0.02 })).toBe("row_count=120, null_ratio=0.02");
  });

  it("summarizeEventMetrics truncates very long summaries instead of overflowing the timeline row", () => {
    const metrics = { note: "x".repeat(200) };
    const summary = summarizeEventMetrics(metrics);
    expect(summary).not.toBeNull();
    expect(summary!.length).toBeLessThanOrEqual(160);
    expect(summary!.endsWith("...")).toBe(true);
  });
});
