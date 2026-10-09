/**
 * The detail of a run that never started (#846).
 *
 * A job that waited for a worker longer than its keys were kept ends as
 * `credentials_required` before Builder makes anything for it: no stages, no manifest, no
 * spec snapshot — only the job. The detail page judged "not found" from a 404 on the
 * stages and the run's absence from the history, so it said the run did not exist and the
 * lost-keys card, the only way on, never appeared. Found by the real-Builder e2e
 * (`e2e/real-multi-user.spec.ts`); a queued run opened by its link was hidden the same way.
 */
import { act, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { clearBuildSpecs, saveBuildSpec } from "@/features/build-spec/specStore";
import * as datasetsApi from "@/features/datasets/api";
import * as runsApi from "@/features/runs/api";
import * as runDetailApi from "@/features/runs/api/runDetail";
import { BuildsPage } from "@/pages/BuildsPage";
import { ApiError, builderApi, type BuildJob } from "@/shared/lib/builderApi";
import type { BuildSpec } from "@/shared/lib/types";

const RUN = "datago-air-station-1";

const SPEC: BuildSpec = {
  datasetId: "datago-air-station",
  title: "Air station",
  description: "Air quality by station",
  sources: [{ provider: "datago", dataset: "air_station", params: {} }],
  exports: [{ format: "jsonl" }],
  metadata: {},
};

function job(status: BuildJob["status"], code?: string): BuildJob {
  return {
    run_id: RUN,
    status,
    created_at: "2026-10-09T00:00:00Z",
    updated_at: "2026-10-09T00:00:02Z",
    ...(code ? { code, error: `${code}: the provider key for datago is no longer held` } : {}),
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
  // What Builder answers for a run that never started: not in the history, and every
  // per-run read is 404 — there is no run directory.
  const notFound = new ApiError(404, "run not found");
  vi.spyOn(runsApi, "listBuilds").mockResolvedValue([]);
  vi.spyOn(datasetsApi, "listBuildStages").mockRejectedValue(notFound);
  vi.spyOn(datasetsApi, "getBuildQuality").mockRejectedValue(notFound);
  vi.spyOn(runDetailApi, "getBuildSpecSnapshot").mockRejectedValue(notFound);
  vi.spyOn(runDetailApi, "getBuildEvents").mockRejectedValue(notFound);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  clearBuildSpecs();
});

describe("a run with no stages that the job registry knows (#846)", () => {
  it("shows the lost-keys card, leading to the edit page, instead of 'not found'", async () => {
    vi.spyOn(builderApi, "getBuildJob").mockResolvedValue(job("failed", "credentials_required"));
    // Kept by this browser when the job was submitted.
    saveBuildSpec(RUN, SPEC);

    const { container } = renderDetail();

    const retry = await screen.findByRole("link", { name: "키를 다시 넣고 재시도" });
    expect(retry.getAttribute("href")).toBe(`/refresh-jobs/${RUN}/edit`);
    expect(container.querySelector(`[data-keys-lost="${RUN}"]`)).not.toBeNull();
    expect(screen.queryByText(/Run을 찾을 수 없습니다/)).not.toBeInTheDocument();
  });

  it("shows a queued run opened by its link, with its cancel button", async () => {
    vi.spyOn(builderApi, "getBuildJob").mockResolvedValue(job("queued"));

    renderDetail();

    expect(await screen.findByRole("button", { name: "실행 취소" })).toBeEnabled();
    expect(screen.queryByText(/Run을 찾을 수 없습니다/)).not.toBeInTheDocument();
  });

  it("does not say 'not found' before the job registry has answered", async () => {
    // Never settles: the stages have answered 404, the registry has not answered at all.
    vi.spyOn(builderApi, "getBuildJob").mockReturnValue(new Promise<BuildJob>(() => {}));
    const seen: string[] = [];
    const observer = new MutationObserver(() => seen.push(document.body.textContent ?? ""));
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });

    renderDetail();
    await waitFor(() => expect(builderApi.getBuildJob).toHaveBeenCalled());
    await waitFor(() => expect(datasetsApi.listBuildStages).toHaveBeenCalled());
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    observer.disconnect();

    expect(screen.queryByText(/Run을 찾을 수 없습니다/)).not.toBeInTheDocument();
    expect(seen.some((text) => text.includes("Run을 찾을 수 없습니다"))).toBe(false);
  });

  it("still says 'not found' when the job registry does not know the run either", async () => {
    vi.spyOn(builderApi, "getBuildJob").mockRejectedValue(new ApiError(404, "run not found"));

    renderDetail();

    expect(await screen.findByText(/Run을 찾을 수 없습니다/)).toBeInTheDocument();
  });
});
