/**
 * Recent Work composite helper (#260) tests.
 */
import { describe, expect, it } from "vitest";
import { toRecentWorkItems } from "./recentWork";

describe("toRecentWorkItems", () => {
  it("tags each item with its correct kind, source, and exact-id href", () => {
    const items = toRecentWorkItems({
      datasets: [
        { dataset_id: "air", title: "대기질", sources: [], latest_run_id: "r1", status: "ok", updated_at: "2026-08-01T00:00:00Z", row_counts: {}, total_row_count: 0, stages: {}, quality: null },
      ],
      builds: [{ id: "run-1", title: "Run 1", status: "succeeded", startedAt: "2026-08-02T00:00:00Z", finishedAt: null }],
      reports: [{ id: "rep-1", title: "Report 1", datasetId: "air", baseRunId: "run-1", createdAt: "x", updatedAt: "2026-08-03T00:00:00Z" }],
      savedSpecs: [{ id: "spec-1", name: "Spec 1", provider: "datago", outputPath: "out", validationStatus: "not_validated", updatedAt: "2026-08-04T00:00:00Z" }],
    });

    expect(items).toHaveLength(4);
    expect(items.find((i) => i.kind === "dataset")).toMatchObject({ id: "air", source: "builder", href: "/tables/air" });
    expect(items.find((i) => i.kind === "build")).toMatchObject({ id: "run-1", source: "builder", href: "/refresh-jobs/run-1" });
    expect(items.find((i) => i.kind === "report")).toMatchObject({ id: "rep-1", source: "local", href: "/reports/rep-1" });
    expect(items.find((i) => i.kind === "savedSpec")).toMatchObject({
      id: "spec-1",
      source: "local",
      href: "/add?savedSpecId=spec-1",
    });
  });

  it("sorts all kinds together by timestamp, newest first", () => {
    const items = toRecentWorkItems({
      datasets: [{ dataset_id: "old", title: "Old", sources: [], latest_run_id: "r", status: "ok", updated_at: "2026-01-01T00:00:00Z", row_counts: {}, total_row_count: 0, stages: {}, quality: null }],
      builds: [{ id: "newest", title: null, status: "succeeded", startedAt: "2026-08-10T00:00:00Z", finishedAt: null }],
      reports: [{ id: "mid", title: "Mid", datasetId: "d", baseRunId: "r", createdAt: "x", updatedAt: "2026-06-01T00:00:00Z" }],
      savedSpecs: [],
    });

    expect(items.map((i) => i.id)).toEqual(["newest", "mid", "old"]);
  });

  it("uses finishedAt as a fallback when a build has no startedAt", () => {
    const items = toRecentWorkItems({
      datasets: [],
      builds: [{ id: "b1", title: null, status: "succeeded", startedAt: null, finishedAt: "2026-08-01T00:00:00Z" }],
      reports: [],
      savedSpecs: [],
    });
    expect(items[0].timestamp).toBe("2026-08-01T00:00:00Z");
  });

  it("pushes items with no timestamp to the end without crashing, preserving their relative order", () => {
    const items = toRecentWorkItems({
      datasets: [{ dataset_id: "no-time", title: "No timestamp", sources: [], latest_run_id: "r", status: "ok", updated_at: null, row_counts: {}, total_row_count: 0, stages: {}, quality: null }],
      builds: [{ id: "has-time", title: null, status: "succeeded", startedAt: "2026-08-01T00:00:00Z", finishedAt: null }],
      reports: [],
      savedSpecs: [],
    });
    expect(items.map((i) => i.id)).toEqual(["has-time", "no-time"]);
  });

  it("falls back to the id as the title when a build has no title", () => {
    const items = toRecentWorkItems({
      datasets: [],
      builds: [{ id: "run-untitled", title: null, status: "succeeded", startedAt: "2026-08-01T00:00:00Z", finishedAt: null }],
      reports: [],
      savedSpecs: [],
    });
    expect(items[0].title).toBe("run-untitled");
  });

  it("returns an empty array when every source list is empty (new-user state)", () => {
    expect(toRecentWorkItems({ datasets: [], builds: [], reports: [], savedSpecs: [] })).toEqual([]);
  });
});
