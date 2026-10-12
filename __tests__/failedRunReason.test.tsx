/**
 * A failed run in the history says why it failed (kpubdata-builder#1120).
 *
 * A run listed by `GET /builds` has ended, so the page does not poll its job — and the
 * list carries no reason. The reason Builder recorded was therefore shown only for a run
 * the page happened to be watching when it failed; opened later from the history, the
 * same run read "failed" with a stage and nothing else. The page now asks the job of a
 * listed failed run once and shows its `error`.
 */
import { act, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as datasetsApi from "@/features/datasets/api";
import { useAuthStore } from "@/features/auth/store";
import * as runsApi from "@/features/runs/api";
import * as runDetailApi from "@/features/runs/api/runDetail";
import { RunDetailPanel } from "@/features/runs/components/RunDetailPanel";
import { BuildsPage } from "@/pages/BuildsPage";
import { i18n } from "@/shared/i18n";
import { ApiError, builderApi, type BuildJob } from "@/shared/lib/builderApi";
import { runStagesResponseSchema } from "@/shared/lib/builderApi.schema";
import type { BuildListItem } from "@/shared/lib/types";

const RUN = "datago-air-station-failed-1";
const SOURCE = "datago.air_station";
const REASON = `${SOURCE}: source '${SOURCE}': the provider refused the request's parameters.`;

function listed(status: BuildListItem["status"]): BuildListItem {
  return {
    id: RUN,
    title: "Air stations",
    status,
    startedAt: "2026-10-09T00:00:00Z",
    finishedAt: "2026-10-09T00:00:02Z",
  } as BuildListItem;
}

function endedJob(patch: Partial<BuildJob>): BuildJob {
  return {
    run_id: RUN,
    status: "failed",
    created_at: "2026-10-09T00:00:00Z",
    updated_at: "2026-10-09T00:00:02Z",
    ...patch,
  };
}

function stages(bronze: "failed" | "completed") {
  const rest = bronze === "failed" ? { status: "not_run", available: false } : { status: "completed", available: true };
  return runStagesResponseSchema.parse({
    run_id: RUN,
    sources: [{ source_key: SOURCE, bronze: { status: bronze, available: bronze === "completed" }, silver: rest, gold: rest }],
  });
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

const reasonLine = () => document.querySelector(`[data-failure-reason="${RUN}"]`);

beforeEach(() => {
  vi.stubEnv("VITE_USE_REAL_BUILDER", "true");
  const notFound = new ApiError(404, "run not found");
  vi.spyOn(datasetsApi, "listBuildStages").mockResolvedValue(stages("failed"));
  vi.spyOn(datasetsApi, "getBuildQuality").mockRejectedValue(notFound);
  vi.spyOn(runDetailApi, "getBuildSpecSnapshot").mockRejectedValue(notFound);
  vi.spyOn(runDetailApi, "getBuildEvents").mockRejectedValue(notFound);
});

afterEach(() => {
  useAuthStore.getState().clear();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("a failed run opened from the history (kpubdata-builder#1120)", () => {
  it("asks its job once and shows the reason Builder recorded", async () => {
    vi.spyOn(runsApi, "listBuilds").mockResolvedValue([listed("failed")]);
    const getJob = vi.spyOn(builderApi, "getBuildJob").mockResolvedValue(endedJob({ error: REASON }));

    renderDetail();

    expect(await screen.findByText(i18n.t("builds.detail.builderError", { error: REASON }))).toBe(reasonLine());
    expect(getJob).toHaveBeenCalledTimes(1);
    expect(getJob.mock.calls[0][0]).toBe(RUN);
  });

  it("shows the reason of a run that failed before any stage was recorded", async () => {
    vi.spyOn(runsApi, "listBuilds").mockResolvedValue([listed("failed")]);
    vi.spyOn(datasetsApi, "listBuildStages").mockRejectedValue(new ApiError(404, "no stages"));
    vi.spyOn(builderApi, "getBuildJob").mockResolvedValue(endedJob({ error: REASON }));

    renderDetail();

    expect(await screen.findByText(i18n.t("builds.detail.builderError", { error: REASON }))).toBeInTheDocument();
  });

  it("adds nothing when Builder has no reason, and keeps the failed stage", async () => {
    vi.spyOn(runsApi, "listBuilds").mockResolvedValue([listed("failed")]);
    const getJob = vi.spyOn(builderApi, "getBuildJob").mockResolvedValue(endedJob({}));

    renderDetail();

    expect(await screen.findByText(i18n.t("builds.detail.failureEvidence"))).toBeInTheDocument();
    await vi.waitFor(() => expect(getJob).toHaveBeenCalledTimes(1));
    expect(reasonLine()).toBeNull();
  });

  it("stays as it was when the job cannot be read: no reason, and no error for the lookup", async () => {
    vi.spyOn(runsApi, "listBuilds").mockResolvedValue([listed("failed")]);
    const getJob = vi.spyOn(builderApi, "getBuildJob").mockRejectedValue(new ApiError(500, "boom"));

    renderDetail();

    expect(await screen.findByText(i18n.t("builds.detail.failureEvidence"))).toBeInTheDocument();
    await vi.waitFor(() => expect(getJob).toHaveBeenCalledTimes(1));
    expect(reasonLine()).toBeNull();
    expect(screen.queryByText(/boom/)).not.toBeInTheDocument();
  });

  it("does not ask for a run that succeeded", async () => {
    vi.spyOn(runsApi, "listBuilds").mockResolvedValue([listed("succeeded")]);
    vi.spyOn(datasetsApi, "listBuildStages").mockResolvedValue(stages("completed"));
    const getJob = vi.spyOn(builderApi, "getBuildJob").mockResolvedValue(endedJob({ status: "succeeded" }));

    renderDetail();

    await screen.findByText(SOURCE);
    expect(getJob).not.toHaveBeenCalled();
    expect(reasonLine()).toBeNull();
  });

  it("uses the existing live lookup when a listed failure never started", async () => {
    vi.spyOn(runsApi, "listBuilds").mockResolvedValue([{ ...listed("failed"), startedAt: null }]);
    const getJob = vi.spyOn(builderApi, "getBuildJob").mockResolvedValue(
      endedJob({ code: "credentials_required", error: "credentials_required: keys were lost" }),
    );

    renderDetail();

    await vi.waitFor(() => expect(getJob).toHaveBeenCalled());
    await act(async () => {});
    expect(getJob).toHaveBeenCalledTimes(1);
  });

  it("aborts the old owner's reason lookup when the account changes", async () => {
    const signals: AbortSignal[] = [];
    let finishAlice!: (job: BuildJob) => void;
    const alice = new Promise<BuildJob>((resolve) => { finishAlice = resolve; });
    vi.spyOn(builderApi, "getBuildJob").mockImplementation((_runId, signal) => {
      if (signal) signals.push(signal);
      return signals.length === 1 ? alice : Promise.resolve(endedJob({ error: "Bob's reason" }));
    });
    act(() => useAuthStore.getState().setOidcIdentity({
      email: "alice@example.test", name: "Alice", userId: "alice", issuer: "https://idp.example.test/realms/kpubdata",
    }));
    render(
      <MemoryRouter>
        <RunDetailPanel
          runId={RUN}
          listItem={listed("failed")}
          outOfListScope={false}
          stagesState={{ status: "error", error: "no stages", notFound: true }}
          qualityState={{ status: "error", error: "no quality", notFound: true }}
          specState={{ status: "error", error: "no spec", notFound: true }}
          eventsState={{ status: "idle" }}
          live={{ kind: "idle" }}
        />
      </MemoryRouter>,
    );
    await vi.waitFor(() => expect(signals).toHaveLength(1));

    act(() => useAuthStore.getState().setOidcIdentity({
      email: "bob@example.test", name: "Bob", userId: "bob", issuer: "https://idp.example.test/realms/kpubdata",
    }));
    await vi.waitFor(() => expect(signals).toHaveLength(2));
    expect(signals[0].aborted).toBe(true);
    await act(async () => finishAlice(endedJob({ error: "Alice's reason" })));
    expect(await screen.findByText(i18n.t("builds.detail.builderError", { error: "Bob's reason" }))).toBeInTheDocument();
    expect(screen.queryByText(/Alice's reason/)).not.toBeInTheDocument();
  });
});
