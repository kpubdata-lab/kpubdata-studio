/**
 * The run's page says why a table was not committed (#881).
 *
 * Add Data opens the run's page as soon as Builder accepts the job (#842), so a build
 * sent with `if_absent` that Builder refuses (`table_exists`) is read there, not in the
 * wizard. Every stage of such a run completed, so the page had no failure evidence to
 * show, and the job's own error is only "build failed".
 */
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as datasetsApi from "@/features/datasets/api";
import * as runsApi from "@/features/runs/api";
import * as runDetailApi from "@/features/runs/api/runDetail";
import { BuildsPage } from "@/pages/BuildsPage";
import { i18n } from "@/shared/i18n";
import { ApiError, builderApi, type BuildJob } from "@/shared/lib/builderApi";
import { runStagesResponseSchema } from "@/shared/lib/builderApi.schema";

const RUN = "datago-air-station-2-1";
const SOURCE = "datago.air_station";

/** A job that ended as Builder ends one whose table it did not commit. */
function failedJob(response: BuildJob["response"]): BuildJob {
  return {
    run_id: RUN,
    status: "failed",
    created_at: "2026-10-09T00:00:00Z",
    updated_at: "2026-10-09T00:00:02Z",
    error: "build failed",
    response,
  };
}

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
  const notFound = new ApiError(404, "run not found");
  const done = { status: "completed", available: true };
  vi.spyOn(runsApi, "listBuilds").mockResolvedValue([]);
  // The build itself went through: every stage completed.
  vi.spyOn(datasetsApi, "listBuildStages").mockResolvedValue(
    runStagesResponseSchema.parse({
      run_id: RUN,
      sources: [{ source_key: SOURCE, bronze: done, silver: done, gold: done }],
    }),
  );
  vi.spyOn(datasetsApi, "getBuildQuality").mockRejectedValue(notFound);
  vi.spyOn(runDetailApi, "getBuildSpecSnapshot").mockRejectedValue(notFound);
  vi.spyOn(runDetailApi, "getBuildEvents").mockRejectedValue(notFound);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("the detail of a run whose table Builder did not commit (#881)", () => {
  it("says another build made the table first", async () => {
    vi.spyOn(builderApi, "getBuildJob").mockResolvedValue(
      failedJob({
        status: "ok",
        run_id: RUN,
        outcomes: [],
        warehouse_failures: { [SOURCE]: { reason: "table_exists", detail: "the table already has a snapshot" } },
      }),
    );

    renderDetail();

    const sentence = await screen.findByText(i18n.t("runs.build.tableExists", { table: SOURCE }));
    expect(sentence).toHaveAttribute("data-commit-refused", RUN);
  });

  it("adds nothing for a failed job with no refused table", async () => {
    vi.spyOn(builderApi, "getBuildJob").mockResolvedValue(failedJob({ status: "failed", run_id: RUN, outcomes: [] }));

    renderDetail();

    // The pipeline is drawn, so the page has settled.
    await screen.findByText(SOURCE);
    expect(document.querySelector("[data-commit-refused]")).toBeNull();
  });
});
