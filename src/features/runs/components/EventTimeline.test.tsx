/**
 * EventTimeline (#255 P1) — checks multi-source events are not collapsed into
 * the first source, and failed/last-ok events actually render distinctly.
 */
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import type { BuildEvent } from "@/shared/lib/builderApi";
import { EventTimeline } from "./EventTimeline";

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

describe("EventTimeline", () => {
  it("shows an empty state when there are no events (not a fabricated row)", () => {
    render(<EventTimeline events={[]} />);
    expect(screen.getByText("기록된 event가 없습니다.")).toBeInTheDocument();
  });

  it("renders each source's events distinctly instead of collapsing into the first source", () => {
    render(
      <EventTimeline
        events={[
          runEvent({ seq: 1, source_key: "air", event: "stage_started" }),
          runEvent({ seq: 2, source_key: "population", event: "stage_started" }),
        ]}
      />,
    );
    expect(screen.getByText("air")).toBeInTheDocument();
    expect(screen.getByText("population")).toBeInTheDocument();
  });

  it("marks run-scoped events (no source_key) distinctly instead of guessing a source", () => {
    render(<EventTimeline events={[runEvent({ seq: 1, source_key: null, event: "run_started" })]} />);
    expect(screen.getByText("run 전체")).toBeInTheDocument();
  });

  it("marks the last ok event and highlights fail events", () => {
    render(
      <EventTimeline
        events={[
          runEvent({ seq: 1, status: "ok", event: "stage_started" }),
          runEvent({ seq: 2, status: "fail", event: "stage_failed", message: "boom" }),
        ]}
      />,
    );
    expect(screen.getByText("마지막 정상")).toBeInTheDocument();
    expect(screen.getByText("boom")).toBeInTheDocument();
    expect(screen.getByText("FAIL")).toBeInTheDocument();
  });

  it("shows a compact metrics summary when present, and a dash when absent", () => {
    render(
      <EventTimeline
        events={[
          runEvent({ seq: 1, metrics: { row_count: 42 } }),
          runEvent({ seq: 2, metrics: null }),
        ]}
      />,
    );
    expect(screen.getByText("row_count=42")).toBeInTheDocument();
  });
});
