/**
 * BuilderHealthPanel with an unavailable worker pool (#607): the contract sends null
 * for the worker counts then, and the panel says "unavailable" instead of `null / null`
 * or a 0% utilization.
 */
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { getMockMonitoringData } from "@/features/monitoring/api/mockData";
import { monitoringSummaryResponseSchema } from "@/shared/lib/builderApi.schema";
import { BuilderHealthPanel } from "./HealthPanels";

describe("BuilderHealthPanel workers", () => {
  const unavailableCount = (summary: Parameters<typeof BuilderHealthPanel>[0]["summary"]) => {
    const { unmount } = render(
      <MemoryRouter>
        <BuilderHealthPanel summary={summary} />
      </MemoryRouter>,
    );
    const count = screen.queryAllByText("측정 불가").length;
    unmount();
    return count;
  };

  it("parses and shows an unavailable pool's null counts as unavailable", () => {
    const withWorkers = (workers: Record<string, unknown>) =>
      monitoringSummaryResponseSchema.parse({
        ...getMockMonitoringData().summary,
        workers: { availability: "unavailable", ...workers },
      });
    // Same availability badge on both sides, so the difference is the two measured cells.
    const baseline = unavailableCount(withWorkers({ active: 2, capacity: 4, utilization: 0.5 }));
    const summary = withWorkers({ active: null, capacity: null, utilization: null });
    expect(unavailableCount(summary)).toBe(baseline + 2);
    render(
      <MemoryRouter>
        <BuilderHealthPanel summary={summary} />
      </MemoryRouter>,
    );
    expect(screen.queryByText("0%")).not.toBeInTheDocument();
    expect(screen.queryByText(/null/)).not.toBeInTheDocument();
  });

  it("shows counts and utilization when the pool reports them", () => {
    render(
      <MemoryRouter>
        <BuilderHealthPanel summary={getMockMonitoringData().summary} />
      </MemoryRouter>,
    );
    expect(screen.getByText("2 / 4")).toBeInTheDocument();
    expect(screen.getByText("50%")).toBeInTheDocument();
  });
});
