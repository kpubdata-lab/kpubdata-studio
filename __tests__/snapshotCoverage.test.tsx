/**
 * A snapshot never reads as complete unless Builder recorded it so (#417, builder#816).
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { mswServer } from "../vitest.setup";
import { coverageCounts, coverageOf } from "@/features/sql/snapshotCoverage";
import { WarehouseWorkspace } from "@/features/sql/WarehouseWorkspace";
import { API_BASE } from "@/shared/config/env";
import { warehouseSnapshotSchema } from "@/shared/lib/builderApi.schema";

// These talk to the Builder over HTTP (MSW); in mock mode the demo warehouse would answer (#530).
beforeEach(() => vi.stubEnv("VITE_USE_REAL_BUILDER", "true"));
afterEach(() => vi.unstubAllEnvs());

const coverage = (status: string, fetched: number | null, reported: number | null) => ({
  status,
  reasons: status === "partial" ? ["fetched_fewer_than_reported"] : [],
  fetched_row_count: fetched,
  source_reported_total: { status: reported === null ? "not_reported" : "reported", value: reported, observed_at: "2026-09-30T00:00:00Z" },
});

const SNAPSHOTS = [
  { snapshot_id: "s3", run_id: "r3", state: "committed", row_count: 3, created_at: "x", committed_at: "x", coverage: coverage("partial", 3, 10) },
  { snapshot_id: "s2", run_id: "r2", state: "committed", row_count: 10, created_at: "x", committed_at: "x", coverage: coverage("complete", 10, 10) },
  { snapshot_id: "s1", run_id: "r1", state: "committed", row_count: 10, created_at: "x", committed_at: "x", coverage: null },
];

describe("coverage words (#417)", () => {
  it("only an explicit complete is complete", () => {
    expect(coverageOf({ coverage: coverage("complete", 1, 1) })).toBe("complete");
    expect(coverageOf({ coverage: coverage("partial", 1, 2) })).toBe("partial");
    expect(coverageOf({ coverage: null })).toBe("unknown");
    expect(coverageOf({})).toBe("unknown");
    expect(coverageOf({ coverage: coverage("something_new", 1, 1) })).toBe("unknown");
  });

  it("counts need both numbers", () => {
    expect(coverageCounts({ coverage: coverage("partial", 3, 10) })).toEqual({ fetched: 3, reported: 10 });
    expect(coverageCounts({ coverage: coverage("unknown", 3, null) })).toBeNull();
  });

  it("an older Builder without coverage still parses", () => {
    const { coverage: _omitted, ...old } = SNAPSHOTS[1];
    expect(warehouseSnapshotSchema.parse(old).coverage).toBeUndefined();
  });
});

describe("the SQL Workspace shows the snapshot's coverage (#417)", () => {
  function renderAt(url: string) {
    mswServer.use(
      http.get(`${API_BASE}/warehouse/tables/air`, () =>
        HttpResponse.json({ table_id: "t", logical_name: "air", current_snapshot_id: "s3", revision: 3, snapshots: SNAPSHOTS }),
      ),
    );
    return render(
      <MemoryRouter initialEntries={[url]}>
        <WarehouseWorkspace tables={[{ table_id: "t", logical_name: "air", current_snapshot_id: "s3", revision: 3 }]} />
      </MemoryRouter>,
    );
  }

  it("current is the partial snapshot, and it says so with the counts", async () => {
    renderAt("/sql?table=air");
    const note = await screen.findByTestId("snapshot-coverage");
    expect(note).toHaveAttribute("data-coverage", "partial");
    expect(note).toHaveTextContent("받은 3행 / 보고 10행");
  });

  it("each option names its coverage, and an unrecorded one is unknown, not complete", async () => {
    renderAt("/sql?table=air");
    await screen.findByTestId("snapshot-coverage");
    const labels = screen.getAllByRole("option").map((option) => option.textContent ?? "");
    expect(labels.find((label) => label.startsWith("s3"))).toMatch(/부분/);
    expect(labels.find((label) => label.startsWith("s2"))).toMatch(/완전/);
    expect(labels.find((label) => label.startsWith("s1"))).toMatch(/알 수 없음/);
    fireEvent.change(screen.getByLabelText("스냅샷"), { target: { value: "s1" } });
    expect(await screen.findByTestId("snapshot-coverage")).toHaveAttribute("data-coverage", "unknown");
  });
});
