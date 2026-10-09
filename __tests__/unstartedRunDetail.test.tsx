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
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { clearBuildSpecs, saveBuildSpec } from "@/features/build-spec/specStore";
import * as artifactsApi from "@/features/artifacts/api";
import * as datasetsApi from "@/features/datasets/api";
import * as runsApi from "@/features/runs/api";
import * as runDetailApi from "@/features/runs/api/runDetail";
import { BuildsPage } from "@/pages/BuildsPage";
import { ApiError, builderApi, type BuildJob } from "@/shared/lib/builderApi";
import { runStagesResponseSchema } from "@/shared/lib/builderApi.schema";
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

  it("never flashes 'not found' while the history is still loading behind a 404 on the stages", async () => {
    let releaseList: (items: []) => void = () => undefined;
    vi.spyOn(runsApi, "listBuilds").mockReturnValue(
      new Promise((resolve) => {
        releaseList = resolve;
      }),
    );
    vi.spyOn(builderApi, "getBuildJob").mockResolvedValue(job("queued"));

    // A transient render is gone before any later assertion can see it, so record every
    // time the alert is put in the document.
    let alertsSeen = 0;
    const observer = new MutationObserver(() => {
      if (document.querySelector('[role="alert"]')) alertsSeen += 1;
    });
    observer.observe(document.body, { childList: true, subtree: true });

    renderDetail();
    // The stages have answered 404 by now; the history has not answered yet.
    await waitFor(() => expect(datasetsApi.listBuildStages).toHaveBeenCalled());
    releaseList([]);

    expect(await screen.findByRole("button", { name: "실행 취소" })).toBeEnabled();
    observer.disconnect();
    expect(alertsSeen).toBe(0);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("does not say 'not found' when the job lookup itself fails, and checks again on request", async () => {
    const lookup = vi
      .spyOn(builderApi, "getBuildJob")
      .mockRejectedValueOnce(new ApiError(500, "internal error"))
      .mockResolvedValue(job("queued"));

    renderDetail();

    expect(await screen.findByText(/존재 여부를 확인하지 못했습니다/)).toBeInTheDocument();
    expect(screen.queryByText(/Run을 찾을 수 없습니다/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "다시 확인" }));

    expect(await screen.findByRole("button", { name: "실행 취소" })).toBeEnabled();
    expect(lookup).toHaveBeenCalledTimes(2);
    expect(screen.queryByText(/존재 여부를 확인하지 못했습니다/)).not.toBeInTheDocument();
  });

  it("does not say 'not found' when the job lookup fails on the network", async () => {
    vi.spyOn(builderApi, "getBuildJob").mockRejectedValue(new TypeError("Failed to fetch"));

    renderDetail();

    expect(await screen.findByText(/존재 여부를 확인하지 못했습니다/)).toBeInTheDocument();
    expect(screen.queryByText(/Run을 찾을 수 없습니다/)).not.toBeInTheDocument();
  });

  // --- #875: what the detail says of such a run, and what it does when the run starts.

  /** The text of everything drawn in a failure colour. */
  function failureText(): string {
    return [...document.querySelectorAll('[class*="text-status-failure"]')].map((node) => node.textContent ?? "").join(" | ");
  }

  it("says a queued run has not started, in no failure colour", async () => {
    vi.spyOn(builderApi, "getBuildJob").mockResolvedValue(job("queued"));

    renderDetail();

    expect(await screen.findByText(/아직 시작하지 않은 실행입니다/)).toBeInTheDocument();
    expect(document.querySelector("[data-run-not-started]")).toHaveAttribute("data-run-not-started", "queued");
    // Watching is not what keeps it going (#842).
    expect(screen.getByText(/이 화면을 떠나도 실행은 계속됩니다/)).toBeInTheDocument();
    expect(screen.getByText("아직 끝나지 않았거나 시작하지 못한 실행이라 품질 결과가 없습니다.")).toBeInTheDocument();
    // The 404s of a run that has made nothing yet are not failures to show.
    expect(failureText()).toBe("");
    expect(screen.queryByText("run not found")).not.toBeInTheDocument();
  });

  it("says a run that lost its keys ended before it started", async () => {
    vi.spyOn(builderApi, "getBuildJob").mockResolvedValue(job("failed", "credentials_required"));
    saveBuildSpec(RUN, SPEC);

    renderDetail();

    expect(await screen.findByText(/시작하기 전에 끝난 실행입니다/)).toBeInTheDocument();
    expect(document.querySelector("[data-run-not-started]")).toHaveAttribute("data-run-not-started", "ended");
    // It has ended: there is nothing left to go on.
    expect(document.querySelector("[data-run-continues]")).toBeNull();
    expect(screen.queryByText("run not found")).not.toBeInTheDocument();
  });

  it("still shows a failure to read the stages of a run that ended as a failure", async () => {
    vi.spyOn(builderApi, "getBuildJob").mockResolvedValue(job("succeeded"));
    vi.spyOn(datasetsApi, "listBuildStages").mockRejectedValue(new ApiError(500, "stage store unreachable"));

    renderDetail();

    expect(await screen.findByText("stage store unreachable")).toBeInTheDocument();
    expect(document.querySelector("[data-run-not-started]")).toBeNull();
    expect(failureText()).toContain("stage store unreachable");
  });

  it("fills the pipeline when the run starts and ends, without a reload", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      // Queued when opened; then Builder runs it and it ends.
      const lookup = vi.spyOn(builderApi, "getBuildJob").mockResolvedValue(job("queued"));
      const stages = vi.spyOn(datasetsApi, "listBuildStages");

      renderDetail();
      expect(await screen.findByText(/아직 시작하지 않은 실행입니다/)).toBeInTheDocument();
      const readsWhileQueued = stages.mock.calls.length;

      lookup.mockResolvedValue(job("succeeded"));
      const done = { status: "completed", available: true };
      stages.mockResolvedValue(
        runStagesResponseSchema.parse({
          run_id: RUN,
          sources: [{ source_key: "datago.air_station", bronze: done, silver: done, gold: done }],
        }),
      );
      await act(async () => {
        await vi.advanceTimersByTimeAsync(runsApi.POLL_INTERVAL_MS + 100);
      });

      await waitFor(() => expect(screen.getByText("datago.air_station")).toBeInTheDocument());
      expect(screen.queryByText(/아직 시작하지 않은 실행입니다/)).not.toBeInTheDocument();
      expect(document.querySelector("[data-run-not-started]")).toBeNull();
      // Asked again because the job's status changed, not because the page was opened again.
      expect(stages.mock.calls.length).toBeGreaterThan(readsWhileQueued);
    } finally {
      vi.useRealTimers();
    }
  });

  // --- #842: a run on its way is not asked for what it has only once it has ended.

  it("says a running run is in progress, and stops asking Builder for its stages", async () => {
    vi.spyOn(builderApi, "getBuildJob").mockResolvedValue(job("running"));
    const stages = vi.spyOn(datasetsApi, "listBuildStages");

    renderDetail();

    expect(await screen.findByText(/실행 중입니다\. 단계 기록은 실행이 끝나면/)).toBeInTheDocument();
    expect(document.querySelector("[data-run-not-started]")).toHaveAttribute("data-run-not-started", "running");
    expect(failureText()).toBe("");
    // Asked once, before the registry had said the run was on its way; not again.
    const asked = stages.mock.calls.length;
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    expect(stages.mock.calls.length).toBe(asked);
    expect(asked).toBeLessThanOrEqual(1);
  });

  it("asks for nothing a run has only at its end, of a run Add Data has just submitted", async () => {
    vi.spyOn(builderApi, "getBuildJob").mockResolvedValue(job("queued"));
    const reads = [
      vi.spyOn(datasetsApi, "listBuildStages"),
      vi.spyOn(datasetsApi, "getBuildQuality"),
      vi.spyOn(runDetailApi, "getBuildSpecSnapshot"),
      // The manifest, which the split card reads: found by the real-Builder e2e, where the
      // browser logged its 404.
      vi.spyOn(artifactsApi, "getBuildManifest"),
    ];

    render(
      <MemoryRouter initialEntries={[{ pathname: `/refresh-jobs/${RUN}`, state: { submittedRunId: RUN } }]}>
        <Routes>
          <Route path="/refresh-jobs/:buildId" element={<BuildsPage />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByText(/아직 시작하지 않은 실행입니다/)).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "실행 취소" })).toBeEnabled();
    // Not one request that Builder could only have answered 404.
    expect(reads.map((read) => read.mock.calls.length)).toEqual([0, 0, 0, 0]);
  });

  it("reads them as before for a run someone else's page says was submitted", async () => {
    // The hint is for the run it names, not for whatever is opened next.
    vi.spyOn(builderApi, "getBuildJob").mockResolvedValue(job("queued"));
    const stages = vi.spyOn(datasetsApi, "listBuildStages");

    render(
      <MemoryRouter initialEntries={[{ pathname: `/refresh-jobs/${RUN}`, state: { submittedRunId: "another-run" } }]}>
        <Routes>
          <Route path="/refresh-jobs/:buildId" element={<BuildsPage />} />
        </Routes>
      </MemoryRouter>,
    );

    await screen.findByText(/아직 시작하지 않은 실행입니다/);
    expect(stages.mock.calls.length).toBe(1);
  });
});
