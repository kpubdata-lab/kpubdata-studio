/**
 * A spec submitted without an output path is run again without one (#883).
 *
 * Add Data leaves the output path out and Builder accepts that spec. The edit form
 * required the path, so running the same definition again — the retry of a run that lost
 * its keys (#787) goes this way — meant inventing a value the definition never had.
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearBuildSpecs, saveBuildSpec } from "@/features/build-spec/specStore";
import * as runsApi from "@/features/runs/api";
import { NewBuildPage } from "@/pages/NewBuildPage";
import type { BuildSpec } from "@/shared/lib/types";

const RUN_ID = "datago-air-station-run";

const SUBMITTED: BuildSpec = {
  datasetId: "datago-air-station",
  title: "측정소별 실시간 대기측정정보",
  description: "설명",
  sources: [{ provider: "datago", dataset: "air_station", params: {} }],
  exports: [{ format: "jsonl" }],
  // As Add Data submits it: no outputPath.
  metadata: {},
};

beforeEach(() => clearBuildSpecs());
afterEach(() => {
  clearBuildSpecs();
  vi.restoreAllMocks();
});

function next() {
  fireEvent.click(screen.getByRole("button", { name: "다음" }));
}

async function openOutputStep(spec: BuildSpec) {
  saveBuildSpec(RUN_ID, spec);
  render(
    <MemoryRouter initialEntries={[`/refresh-jobs/${RUN_ID}/edit`]}>
      <Routes>
        <Route path="/refresh-jobs/:buildId/edit" element={<NewBuildPage />} />
      </Routes>
    </MemoryRouter>,
  );
  await screen.findByRole("heading", { name: "기본 정보" }, { timeout: 8000 });
  next();
  await screen.findByRole("heading", { name: "데이터 소스" });
  next();
  await screen.findByRole("heading", { name: "파라미터" });
  next();
  await screen.findByRole("heading", { name: "미리보기" });
  next();
  await screen.findByRole("heading", { name: "출력 형식" });
}

describe("the edit form and a spec without an output path (#883)", () => {
  it("goes on to the review step with the path left empty, and says where the build writes", async () => {
    await openOutputStep(SUBMITTED);

    const path = screen.getByLabelText(/출력 경로/);
    expect(path).toHaveValue("");
    expect(screen.queryByText("(필수)")).not.toBeInTheDocument();
    expect(screen.getByText("비워 두면 처음 제출한 대로 artifacts/builds/datago-air-station 아래에 씁니다.")).toBeInTheDocument();

    next();

    expect(await screen.findByRole("heading", { name: "검증·실행" })).toBeInTheDocument();
    expect(screen.queryByText("출력 경로를 입력해주세요.")).not.toBeInTheDocument();
  });

  it("runs the definition as it was submitted: no output path is added", async () => {
    const executed = vi.spyOn(runsApi, "executeBuild");
    await openOutputStep(SUBMITTED);
    next();
    await screen.findByRole("heading", { name: "검증·실행" });
    fireEvent.click(screen.getByRole("button", { name: "다시 검증" }));
    await screen.findByText("검증을 통과했습니다. 실행할 수 있습니다.");

    fireEvent.click(screen.getByRole("button", { name: "갱신" }));

    expect(await screen.findByText(/실행 성공/)).toBeInTheDocument();
    const sent = executed.mock.calls[0]![0];
    expect(sent.metadata).toEqual({});
    expect(sent.exports).toEqual([{ format: "jsonl" }]);
  });

  it("takes a path when one is typed", async () => {
    const executed = vi.spyOn(runsApi, "executeBuild");
    await openOutputStep(SUBMITTED);
    fireEvent.change(screen.getByLabelText(/출력 경로/), { target: { value: "out/station" } });
    next();
    await screen.findByRole("heading", { name: "검증·실행" });
    fireEvent.click(screen.getByRole("button", { name: "다시 검증" }));
    await screen.findByText("검증을 통과했습니다. 실행할 수 있습니다.");

    fireEvent.click(screen.getByRole("button", { name: "갱신" }));

    await screen.findByText(/실행 성공/);
    expect(executed.mock.calls[0]![0].metadata).toEqual({ outputPath: "out/station" });
  });

  it("still requires the path of a spec that had one", async () => {
    await openOutputStep({ ...SUBMITTED, metadata: { outputPath: "artifacts/builds/station" } });

    const path = screen.getByLabelText(/출력 경로/);
    expect(path).toHaveValue("artifacts/builds/station");
    fireEvent.change(path, { target: { value: "" } });
    next();

    expect(await screen.findByText("출력 경로를 입력해주세요.")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "검증·실행" })).not.toBeInTheDocument();
  });
});
