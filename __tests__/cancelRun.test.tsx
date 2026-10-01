/**
 * Cancelling a run from its detail page (#655).
 *
 * A run opened at `/refresh-jobs/:id` after its submit form is gone is the case: the
 * live registry (`GET /builds/{run_id}`) says it is active, so a cancel button is shown.
 * One confirmed click sends exactly one `POST /builds/{run_id}/cancel`; a declined
 * confirmation sends none; `cancelling`/`cancelled` disable the button; the run's status
 * still comes only from Builder.
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { mswServer } from "../vitest.setup";
import * as datasetsApi from "@/features/datasets/api";
import * as runsApi from "@/features/runs/api";
import { BuildsPage } from "@/pages/BuildsPage";
import { API_BASE } from "@/shared/config/env";
import { builderApi, type BuildJob } from "@/shared/lib/builderApi";

const RUN = "run-live-1";

function job(status: BuildJob["status"]): BuildJob {
  return { run_id: RUN, status, created_at: "2026-10-01T00:00:00Z", updated_at: "2026-10-01T00:00:01Z" };
}

let cancelRequests: string[];
let cancelResponse: () => Response;

function renderDetail() {
  return render(
    <MemoryRouter initialEntries={[`/refresh-jobs/${RUN}`]}>
      <Routes>
        <Route path="/refresh-jobs/:buildId" element={<BuildsPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.stubEnv("VITE_USE_REAL_BUILDER", "true");
  cancelRequests = [];
  cancelResponse = () => HttpResponse.json(job("cancelling"));
  // Out of the history list: the live registry is what this detail reads.
  vi.spyOn(runsApi, "listBuilds").mockResolvedValue([]);
  vi.spyOn(datasetsApi, "listBuildStages").mockResolvedValue({ run_id: RUN, sources: [] });
  vi.spyOn(datasetsApi, "getBuildQuality").mockResolvedValue({
    run_id: RUN,
    availability: "unavailable",
    evaluated_checks: 0,
    quality_results: {},
    schema_drift: {},
  });
  mswServer.use(
    http.post(`${API_BASE}/builds/:run/cancel`, ({ params }) => {
      cancelRequests.push(String(params.run));
      return cancelResponse();
    }),
  );
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("cancel a run from its detail (#655)", () => {
  it("shows a cancel button for a running run opened by its link, and one confirmed click posts once", async () => {
    vi.spyOn(builderApi, "getBuildJob").mockResolvedValue(job("running"));
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    renderDetail();

    const button = await screen.findByRole("button", { name: "실행 취소" });
    expect(button).toBeEnabled();
    fireEvent.click(button);

    expect(confirm).toHaveBeenCalledTimes(1);
    expect(await screen.findByText(/취소를 요청했습니다/)).toBeInTheDocument();
    expect(cancelRequests).toEqual([RUN]);
    // Accepted, but Builder has not reported a new status yet: the button waits, no second request.
    expect(screen.getByRole("button", { name: "실행 취소" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "실행 취소" }));
    expect(cancelRequests).toEqual([RUN]);
  });

  it("sends nothing when the confirmation is declined", async () => {
    vi.spyOn(builderApi, "getBuildJob").mockResolvedValue(job("queued"));
    vi.spyOn(window, "confirm").mockReturnValue(false);
    renderDetail();

    fireEvent.click(await screen.findByRole("button", { name: "실행 취소" }));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(cancelRequests).toEqual([]);
    expect(screen.getByRole("button", { name: "실행 취소" })).toBeEnabled();
  });

  it.each([
    ["cancelling", "취소 중…"],
    ["cancelled", "취소됨"],
  ] as const)("disables the button when Builder reports %s", async (status, label) => {
    vi.spyOn(builderApi, "getBuildJob").mockResolvedValue(job(status));
    renderDetail();

    expect(await screen.findByRole("button", { name: label })).toBeDisabled();
  });

  it("has no cancel button for a finished run", async () => {
    vi.spyOn(builderApi, "getBuildJob").mockResolvedValue(job("succeeded"));
    renderDetail();

    await screen.findByText("성공", { selector: "span" });
    expect(screen.queryByRole("button", { name: /실행 취소|취소 중|취소됨/ })).not.toBeInTheDocument();
  });

  it("says a 409 means the run already finished, and does not retry", async () => {
    vi.spyOn(builderApi, "getBuildJob").mockResolvedValue(job("running"));
    vi.spyOn(window, "confirm").mockReturnValue(true);
    cancelResponse = () => HttpResponse.json({ error: "job already finished" }, { status: 409 });
    renderDetail();

    fireEvent.click(await screen.findByRole("button", { name: "실행 취소" }));
    expect(await screen.findByText(/이미 끝난 실행이라/)).toBeInTheDocument();
    await waitFor(() => expect(cancelRequests).toEqual([RUN]));
  });

  it("says a 403 means the run is not the caller's", async () => {
    vi.spyOn(builderApi, "getBuildJob").mockResolvedValue(job("running"));
    vi.spyOn(window, "confirm").mockReturnValue(true);
    cancelResponse = () => HttpResponse.json({ error: "not the owner" }, { status: 403 });
    renderDetail();

    fireEvent.click(await screen.findByRole("button", { name: "실행 취소" }));
    expect(await screen.findByText(/취소할 권한이 없습니다/)).toBeInTheDocument();
    expect(cancelRequests).toEqual([RUN]);
  });
});
