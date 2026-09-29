import { describe, expect, it } from "vitest";
import { buildEventsResponseSchema } from "./builderApi.schema";

const event = (seq: number, name: string, extra: Record<string, unknown> = {}) => ({
  seq,
  timestamp: "2026-09-29T00:00:00+00:00",
  run_id: "run-1",
  event: name,
  status: "ok",
  source_key: null,
  stage: null,
  message: null,
  metrics: null,
  ...extra,
});

describe("build event timeline", () => {
  it("parses a cancelled run's timeline (builder#481 emits run_cancelled)", () => {
    const parsed = buildEventsResponseSchema.safeParse({
      run_id: "run-1",
      events: [event(1, "run_submitted"), event(2, "run_started"), event(3, "run_cancelled")],
    });

    expect(parsed.success).toBe(true);
  });

  it("parses fetch progress for a param_grid source (builder#648)", () => {
    const parsed = buildEventsResponseSchema.safeParse({
      run_id: "run-1",
      events: [
        event(1, "source_fetch_started", { source_key: "datago.apt_trade" }),
        event(2, "source_fetch_progress", {
          source_key: "datago.apt_trade",
          metrics: { done: 1, total: 1500 },
        }),
      ],
    });

    expect(parsed.success).toBe(true);
  });

  it("still rejects a name outside the contract", () => {
    const parsed = buildEventsResponseSchema.safeParse({
      run_id: "run-1",
      events: [event(1, "not_an_event")],
    });

    expect(parsed.success).toBe(false);
  });
});
