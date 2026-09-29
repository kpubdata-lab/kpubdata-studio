import { act, render, renderHook, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, type DatasetRunSummary } from "@/shared/lib/builderApi";
import { useUIStore } from "@/shared/hooks/useUIStore";

// #418: a run missing from the newest page is asked for directly, and Builder decides
// whether it is this dataset's (404) and the caller's (403).
const { getDatasetRunMock, listDatasetRunsMock, listBuildStagesMock } = vi.hoisted(() => ({
  getDatasetRunMock: vi.fn(),
  listDatasetRunsMock: vi.fn(),
  listBuildStagesMock: vi.fn(),
}));

vi.mock("@/features/datasets/api", async (importActual) => {
  const actual = await importActual<typeof import("@/features/datasets/api")>();
  return {
    ...actual,
    getDatasetRun: getDatasetRunMock,
    listDatasetRuns: listDatasetRunsMock,
    listBuildStages: listBuildStagesMock.mockImplementation(actual.listBuildStages),
  };
});

import { useRequestedRun } from "@/features/datasets/useRequestedRun";
import { DatasetDetailPage } from "@/pages/DatasetDetailPage";

const LATEST: DatasetRunSummary = {
  run_id: "air-2026-08-14",
  status: "failed",
  started_at: "2026-08-14T07:00:00Z",
  finished_at: "2026-08-14T07:30:00Z",
  spec_digest: "sha256:air14",
  created_by: "user@example.com",
};
const OLDER: DatasetRunSummary = { ...LATEST, run_id: "air-2026-08-13", status: "ok", spec_digest: "sha256:air13" };

beforeEach(() => {
  vi.stubEnv("VITE_USE_REAL_BUILDER", "false");
  act(() => useUIStore.setState({ isAssistantDrawerOpen: false }));
  getDatasetRunMock.mockReset();
  listBuildStagesMock.mockClear();
  // The page holds only the newest run; the older one is outside it.
  listDatasetRunsMock.mockReset().mockResolvedValue({ dataset_id: "air-quality", runs: [LATEST] });
});
afterEach(() => vi.unstubAllEnvs());

describe("useRequestedRun (#418)", () => {
  it("does not ask Builder when the run is in the page", () => {
    const { result } = renderHook(() => useRequestedRun("air-quality", LATEST.run_id, [LATEST]));
    expect(result.current).toEqual({ status: "available", run: LATEST, inPage: true });
    expect(getDatasetRunMock).not.toHaveBeenCalled();
  });

  it("is loading until the page has loaded, and none without a requested run", () => {
    expect(renderHook(() => useRequestedRun("air-quality", "x", undefined)).result.current).toEqual({ status: "loading" });
    expect(renderHook(() => useRequestedRun("air-quality", null, [LATEST])).result.current).toEqual({ status: "none" });
  });

  it("finds a run older than the page directly", async () => {
    getDatasetRunMock.mockResolvedValue({ dataset_id: "air-quality", run: OLDER });
    const { result } = renderHook(() => useRequestedRun("air-quality", OLDER.run_id, [LATEST]));

    expect(result.current).toEqual({ status: "loading" });
    await waitFor(() => expect(result.current).toEqual({ status: "available", run: OLDER, inPage: false }));
    expect(getDatasetRunMock).toHaveBeenCalledWith("air-quality", OLDER.run_id, expect.any(AbortSignal));
  });

  it.each([
    [404, "not_found"],
    [403, "forbidden"],
    [500, "error"],
  ])("maps Builder's %i to %s", async (status, expected) => {
    getDatasetRunMock.mockRejectedValue(new ApiError(status, "x"));
    const { result } = renderHook(() => useRequestedRun("air-quality", "some-run", [LATEST]));
    await waitFor(() => expect(result.current).toEqual({ status: expected }));
  });
});

function renderDetail(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/tables/:datasetId" element={<DatasetDetailPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("Dataset Detail with a run outside the newest page (#418)", () => {
  it("opens a permalink to an older run instead of calling it invalid", async () => {
    getDatasetRunMock.mockResolvedValue({ dataset_id: "air-quality", run: OLDER });
    renderDetail(`/tables/air-quality?run=${OLDER.run_id}`);

    await waitFor(() => expect(screen.getByLabelText("Run 선택")).toHaveValue(OLDER.run_id));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    await waitFor(() => expect(listBuildStagesMock).toHaveBeenCalledWith(OLDER.run_id, expect.any(AbortSignal)));
  });

  it("says a forbidden run is forbidden, and loads nothing for it", async () => {
    getDatasetRunMock.mockRejectedValue(new ApiError(403, "forbidden: not run owner"));
    renderDetail("/tables/air-quality?run=someone-elses-run");

    expect(await screen.findByRole("alert")).toHaveTextContent("이 run에 접근할 권한이 없습니다");
    expect(listBuildStagesMock).not.toHaveBeenCalledWith("someone-elses-run", expect.anything());
  });

  it("says a run that is not this dataset's was not found", async () => {
    getDatasetRunMock.mockRejectedValue(new ApiError(404, "run not found in dataset"));
    renderDetail("/tables/air-quality?run=missing-run");

    expect(await screen.findByRole("alert")).toHaveTextContent("선택한 run을 찾을 수 없습니다");
  });
});
