import { render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/shared/lib/builderApi";
import { datasetQualityHistoryResponseSchema, type DatasetQualityHistoryResponse } from "@/shared/lib/builderApi.schema";

import { QUALITY_TREND_LIMIT, QualityTrend, QualityTrendView } from "./QualityTrend";
import { QualityTab } from "./RunPanels";

const api = vi.hoisted(() => ({ getDatasetQualityHistory: vi.fn() }));
vi.mock("@/features/datasets/api", () => api);
const getDatasetQualityHistory = api.getDatasetQualityHistory;

// The contract's own example (builder-api.yaml `AirQualityHistory`) plus a run that was evaluated and
// failed, so every branch the trend draws is fed from the shape Builder actually sends (#650).
const history: DatasetQualityHistoryResponse = datasetQualityHistoryResponseSchema.parse({
  dataset_id: "seoul-air-quality",
  runs: [
    { run_id: "air-0815", timestamp: "2026-08-15T09:30:07+00:00", status: "ok", pass_count: 2, warn_count: 1, fail_count: 0, evaluated_checks: 3, rule_pass_rate: 2 / 3, validated_rows: 25 },
    { run_id: "air-0814", timestamp: "2026-08-14T09:30:07+00:00", status: "failed", pass_count: 0, warn_count: 0, fail_count: 0, evaluated_checks: 0, rule_pass_rate: null, validated_rows: null },
    { run_id: "air-0813", timestamp: "2026-08-13T09:30:07+00:00", status: "ok", pass_count: 1, warn_count: 0, fail_count: 1, evaluated_checks: 2, rule_pass_rate: 0.5, validated_rows: 1200 },
    { run_id: "air-legacy", timestamp: null, status: "ok", pass_count: 0, warn_count: 0, fail_count: 0, evaluated_checks: 0, rule_pass_rate: null, validated_rows: null },
  ],
});

function row(runId: string) {
  const element = document.querySelector(`tr[data-run-id="${runId}"]`);
  if (!(element instanceof HTMLElement)) throw new Error(`no row for ${runId}`);
  return element;
}

describe("QualityTrendView (#650)", () => {
  it("lists runs newest first, as Builder ordered them", () => {
    render(<QualityTrendView state={{ status: "loaded", data: history }} />);
    const ids = [...document.querySelectorAll("tr[data-run-id]")].map((element) => element.getAttribute("data-run-id"));
    expect(ids).toEqual(["air-0815", "air-0814", "air-0813", "air-legacy"]);
  });

  it("shows rule_pass_rate as a percent with passed-of-evaluated beside it", () => {
    render(<QualityTrendView state={{ status: "loaded", data: history }} />);
    expect(within(row("air-0815")).getByText("67%")).toBeInTheDocument();
    expect(within(row("air-0815")).getByText("(3개 중 2개 통과)")).toBeInTheDocument();
    expect(within(row("air-0815")).getByText("PASS 2 · WARN 1 · FAIL 0")).toBeInTheDocument();
    expect(within(row("air-0813")).getByText("50%")).toBeInTheDocument();
  });

  it("reads a run with no evaluated checks as N/A, never 0% or PASS", () => {
    render(<QualityTrendView state={{ status: "loaded", data: history }} />);
    const unevaluated = row("air-0814");
    expect(unevaluated.querySelectorAll('[data-status="not-evaluated"]')).toHaveLength(2);
    expect(within(unevaluated).queryByText(/0%/)).toBeNull();
    expect(within(unevaluated).queryByText(/PASS/)).toBeNull();
    expect(unevaluated.querySelector("[data-segment]")).toBeNull();
    // A null validated_rows is "not reported", not 0.
    expect(unevaluated.querySelector('[data-status="missing"]')).not.toBeNull();
    expect(within(unevaluated).getByText("실행 실패")).toBeInTheDocument();
  });

  it("says unknown, not 0%, when checks ran but Builder sent no rate", () => {
    const run = { ...history.runs[0], run_id: "air-norate", rule_pass_rate: null };
    render(<QualityTrendView state={{ status: "loaded", data: { ...history, runs: [run] } }} />);
    const cell = row("air-norate");
    expect(cell.querySelector('[data-status="unknown"]')).not.toBeNull();
    expect(within(cell).queryByText(/%/)).toBeNull();
    expect(screen.getByText("이 이력에는 아직 통과율이 평가된 실행이 없습니다.")).toBeInTheDocument();
  });

  it("marks a legacy run with a null timestamp as 'time not recorded'", () => {
    render(<QualityTrendView state={{ status: "loaded", data: history }} />);
    const legacy = row("air-legacy");
    expect(legacy.querySelector('[data-legacy-run="true"]')).toHaveTextContent("시각 미기록");
    expect(row("air-0815").querySelector("[data-legacy-run]")).toBeNull();
  });

  it("draws the pass rate oldest to newest and leaves a gap for an unrated run", () => {
    render(<QualityTrendView state={{ status: "loaded", data: history }} />);
    const chart = document.querySelector('svg[data-chart="pass-rate"]');
    expect(chart).not.toBeNull();
    const points = [...chart!.querySelectorAll("circle[data-point]")].map((point) => point.getAttribute("data-point"));
    expect(points).toEqual(["air-0813", "air-0815"]);
    // air-0814 sits between the two rated runs, so no line joins them.
    expect(chart!.querySelectorAll("path")).toHaveLength(0);
    expect(screen.getByText(/끊긴 구간은 평가된 검사가 없는 실행입니다\(2개\)/)).toBeInTheDocument();
  });

  it("shows an empty state for an empty history", () => {
    render(<QualityTrendView state={{ status: "loaded", data: { dataset_id: "x", runs: [] } }} />);
    expect(document.querySelector('[data-trend-state="empty"]')).not.toBeNull();
    expect(screen.getByText("아직 품질 이력이 없습니다")).toBeInTheDocument();
    expect(document.querySelector("svg[data-chart]")).toBeNull();
  });

  it("shows an empty state for a 404, and an error for anything else", () => {
    const { unmount } = render(<QualityTrendView state={{ status: "not-found" }} />);
    expect(document.querySelector('[data-trend-state="empty"]')).not.toBeNull();
    unmount();
    render(<QualityTrendView state={{ status: "error", error: "boom" }} />);
    expect(screen.getByRole("alert")).toHaveTextContent("품질 이력을 불러오지 못했습니다");
    expect(screen.getByRole("alert")).toHaveTextContent("boom");
    expect(document.querySelector('[data-trend-state="empty"]')).toBeNull();
  });
});

describe("QualityTrend loading (#650)", () => {
  beforeEach(() => {
    getDatasetQualityHistory.mockReset();
  });

  it("asks for a bounded history of this table", async () => {
    getDatasetQualityHistory.mockResolvedValue(history);
    render(<QualityTrend datasetId="seoul-air-quality" />);
    await waitFor(() => expect(document.querySelector('tr[data-run-id="air-0815"]')).not.toBeNull());
    expect(getDatasetQualityHistory).toHaveBeenCalledWith("seoul-air-quality", QUALITY_TREND_LIMIT, expect.any(AbortSignal));
  });

  it("turns a 404 into the empty state", async () => {
    getDatasetQualityHistory.mockRejectedValue(new ApiError(404, "dataset not found: x"));
    render(<QualityTrend datasetId="x" />);
    await waitFor(() => expect(document.querySelector('[data-trend-state="empty"]')).not.toBeNull());
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("turns any other failure into an error, not an empty history", async () => {
    getDatasetQualityHistory.mockRejectedValue(new ApiError(500, "internal"));
    render(<QualityTrend datasetId="x" />);
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("internal"));
    expect(document.querySelector('[data-trend-state="empty"]')).toBeNull();
  });

  it("is part of the Quality tab, even while the selected run's quality is still loading", async () => {
    getDatasetQualityHistory.mockResolvedValue(history);
    render(
      <MemoryRouter>
        <QualityTab state={{ status: "loading" }} status="N/A" results={[]} drift={[]} datasetId="seoul-air-quality" runId="air-0815" source="" />
      </MemoryRouter>,
    );
    await waitFor(() => expect(document.querySelector('tr[data-run-id="air-0815"]')).not.toBeNull());
    expect(screen.getByText("실행별 품질 추이")).toBeInTheDocument();
  });
});
