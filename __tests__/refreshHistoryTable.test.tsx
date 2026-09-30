/**
 * Refresh history as one filterable table with run details (#535).
 *
 * - `/refresh-jobs` is one table: Run ID, Table, Status, Started, Duration, Snapshot.
 * - What `GET /builds` does not send (the table, the snapshot) is `—`, never guessed.
 * - Search and status live in the URL, so they survive a round trip to a detail.
 * - The run id is a link to `/refresh-jobs/:id`, where the diagnostics are.
 */
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as runsApi from "@/features/runs/api";
import { BuildsPage } from "@/pages/BuildsPage";
import type { BuildListItem } from "@/shared/lib/types";

const ITEMS: BuildListItem[] = [
  { id: "run-ok", title: null, status: "succeeded", startedAt: "2026-09-30T01:00:00+00:00", finishedAt: "2026-09-30T01:02:05+00:00" },
  { id: "run-failed", title: null, status: "failed", startedAt: "2026-09-30T00:00:00+00:00", finishedAt: null },
];

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location">{location.pathname}{location.search}</output>;
}

function renderHistory(initialPath = "/refresh-jobs") {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <LocationProbe />
      <Routes>
        <Route path="/refresh-jobs" element={<BuildsPage />} />
        <Route path="/refresh-jobs/:buildId" element={<p>detail</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.spyOn(runsApi, "listBuilds").mockResolvedValue(ITEMS);
});
afterEach(() => vi.restoreAllMocks());

describe("Refresh history (#535)", () => {
  it("is one table titled Refresh History, with no detail beside it", async () => {
    renderHistory();

    expect(screen.getByRole("heading", { level: 1, name: "갱신 이력" })).toBeInTheDocument();
    const table = await screen.findByRole("table", { name: "갱신 이력" });
    const headers = within(table).getAllByRole("columnheader").map((cell) => cell.textContent);
    expect(headers).toEqual(["Run ID", "테이블", "상태", "시작", "소요 시간", "스냅샷"]);
    expect(within(table).getAllByRole("row")).toHaveLength(3);
    expect(screen.queryByText("Pipeline / Stage Progress")).not.toBeInTheDocument();
  });

  it("shows what GET /builds does not send as —, and the duration from the two timestamps", async () => {
    renderHistory();

    const ok = await screen.findByRole("row", { name: /run-ok/ });
    const cells = within(ok).getAllByRole("cell");
    expect(cells[1].querySelector('[data-status="missing"]')).not.toBeNull();
    expect(cells[4]).toHaveTextContent("125초");
    expect(cells[5].querySelector('[data-status="missing"]')).not.toBeNull();

    const failed = screen.getByRole("row", { name: /run-failed/ });
    expect(within(failed).getAllByRole("cell")[4].querySelector('[data-status="missing"]')).not.toBeNull();
    expect(within(failed).getByText("실패").closest("[data-status]")).toHaveAttribute("data-status", "actionable");
  });

  it("keeps search and status in the URL and filters the rows", async () => {
    renderHistory();
    await screen.findByRole("row", { name: /run-ok/ });

    fireEvent.change(screen.getByLabelText("상태 필터"), { target: { value: "failed" } });
    await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent("status=failed"));
    expect(screen.queryByRole("row", { name: /run-ok/ })).not.toBeInTheDocument();
    expect(screen.getByRole("row", { name: /run-failed/ })).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Run 검색"), { target: { value: "nothing-matches" } });
    await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent("q=nothing-matches"));
    expect(screen.queryByRole("table", { name: "갱신 이력" })).not.toBeInTheDocument();
  });

  it("restores the filters from the URL when coming back from a detail", async () => {
    renderHistory("/refresh-jobs?status=failed");
    await screen.findByRole("row", { name: /run-failed/ });
    expect(screen.getByLabelText("상태 필터")).toHaveValue("failed");
    expect(screen.queryByRole("row", { name: /run-ok/ })).not.toBeInTheDocument();
  });

  it("opens a run's detail at /refresh-jobs/:id from its run id link or its row", async () => {
    renderHistory();
    const link = await screen.findByRole("link", { name: "run-ok" });
    expect(link).toHaveAttribute("href", "/refresh-jobs/run-ok");

    fireEvent.click(screen.getByRole("row", { name: /run-failed/ }));
    await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent("/refresh-jobs/run-failed"));
    expect(screen.getByText("detail")).toBeInTheDocument();
  });
});
