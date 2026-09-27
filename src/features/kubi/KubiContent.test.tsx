/**
 * `/query` 결과 row 값 표시 regression test (#256 리뷰 §1).
 *
 * array/object 값이 `String(value)`를 거쳐 "[object Object]"로 뭉개지지 않고, 실제 JSON
 * 내용이 보이는지 확인한다. null/primitive는 기존 표시 방식을 그대로 유지해야 한다.
 */
import { describe, expect, it } from "vitest";
import { evidenceDetail, evidenceDetailEntries, evidenceHref, formatQueryValue } from "./KubiContent";
import type { KubiTurn } from "./types";

describe("formatQueryValue (#256 리뷰 §1)", () => {
  it("shows a dash for null/undefined, matching the previous behavior", () => {
    expect(formatQueryValue(null)).toBe("—");
    expect(formatQueryValue(undefined)).toBe("—");
  });

  it("shows primitives as plain text, matching the previous behavior", () => {
    expect(formatQueryValue("서울")).toBe("서울");
    expect(formatQueryValue(42)).toBe("42");
    expect(formatQueryValue(0)).toBe("0");
    expect(formatQueryValue(true)).toBe("true");
    expect(formatQueryValue(false)).toBe("false");
  });

  it("renders an array as its actual JSON content, not [object Object]", () => {
    expect(formatQueryValue([1, 2, 3])).toBe("[1,2,3]");
    expect(formatQueryValue(["서울", "부산"])).toBe(JSON.stringify(["서울", "부산"]));
  });

  it("renders a plain object as its actual JSON content, not [object Object]", () => {
    const value = { region: "서울", count: 12 };
    expect(formatQueryValue(value)).toBe(JSON.stringify(value));
    expect(formatQueryValue(value)).not.toBe("[object Object]");
  });

  it("renders nested array/object values without collapsing them", () => {
    const value = { tags: ["a", "b"], meta: { ok: true } };
    expect(formatQueryValue(value)).toBe(JSON.stringify(value));
  });

  it("renders an empty array/object distinctly from null", () => {
    expect(formatQueryValue([])).toBe("[]");
    expect(formatQueryValue({})).toBe("{}");
  });
});

describe("stage evidence detail", () => {
  it("resolves only the exact canonical stage ref to frozen evidence", () => {
    const refId = "run-1::provider.dataset::gold";
    const turn = {
      id: "turn-1",
      question: "Gold 컬럼",
      context: { page: "quality", runId: "run-1", source: "provider.dataset", stage: "gold" },
      createdAt: "2026-08-30T00:00:00Z",
      status: "ok",
      query: { status: "idle" },
      actionStates: {},
      evidence: {
        fetchedAt: "2026-08-30T00:00:00Z",
        context: { page: "quality", runId: "run-1", source: "provider.dataset", stage: "gold" },
        stage: { refId, stage: "gold", source: "provider.dataset", status: "completed", available: true, rowCount: 40, columns: Array.from({ length: 23 }, (_, index) => `column_${index}`) },
        deepLinks: {},
        partial: false,
        unavailable: [],
      },
    } satisfies KubiTurn;
    expect(evidenceDetail(turn, { kind: "stage", id: refId, label: "Gold" })).toMatchObject({
      stage: "gold",
      source: "provider.dataset",
      status: "completed",
      rowCount: 40,
    });
    expect(evidenceDetail(turn, { kind: "stage", id: "run-1::provider.dataset::silver", label: "wrong" })).toBeNull();
    expect(evidenceDetailEntries(turn, { kind: "stage", id: refId, label: "Gold" })).toEqual([
      ["Stage", "Gold"],
      ["Source", "provider.dataset"],
      ["Status", "completed"],
      ["Rows", "40"],
      ["Columns", "23"],
    ]);
  });
});

describe("evidenceHref run navigation", () => {
  const turn = {
    id: "turn-links",
    question: "근거 링크",
    context: { page: "quality", datasetId: "dataset-1", runId: "run-current", source: "provider.dataset", stage: "gold" },
    createdAt: "2026-08-30T00:00:00Z",
    status: "ok",
    query: { status: "idle" },
    actionStates: {},
    evidence: {
      fetchedAt: "2026-08-30T00:00:00Z",
      context: { page: "quality", datasetId: "dataset-1", runId: "run-current", source: "provider.dataset", stage: "gold" },
      recentRuns: [
        { runId: "run-current", status: "completed", startedAt: null, finishedAt: null },
        { runId: "run-previous", status: "completed", startedAt: null, finishedAt: null },
      ],
      stage: { refId: "run-current::provider.dataset::gold", stage: "gold", source: "provider.dataset", status: "completed", available: true, rowCount: 40 },
      deepLinks: {},
      partial: false,
      unavailable: [],
    },
  } satisfies KubiTurn;

  it("uses the verified current run detail and retains its source/stage context", () => {
    expect(evidenceHref(turn, { kind: "run", id: "run-current", label: "현재 Run" })).toBe(
      "/builds?run=run-current&dataset=dataset-1&source=provider.dataset&stage=gold",
    );
  });

  it("uses a verified different recent run and does not carry current source/stage", () => {
    expect(evidenceHref(turn, { kind: "run", id: "run-previous", label: "이전 Run" })).toBe(
      "/builds?run=run-previous&dataset=dataset-1",
    );
  });

  it("keeps the verified stage ref navigation on its current run/source/stage", () => {
    expect(evidenceHref(turn, { kind: "stage", id: "run-current::provider.dataset::gold", label: "Gold" })).toBe(
      "/builds?run=run-current&dataset=dataset-1&source=provider.dataset&stage=gold",
    );
  });
});
