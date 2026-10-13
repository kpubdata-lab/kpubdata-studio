/**
 * The output step says when Builder would refuse the typed path, before anything is sent
 * (kpubdata-builder#1320).
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { clearBuildSpecs, saveBuildSpec } from "@/features/build-spec/specStore";
import { NewBuildPage } from "@/pages/NewBuildPage";
import type { BuildSpec } from "@/shared/lib/types";

const RUN_ID = "datago-air-station-run";

const SPEC: BuildSpec = {
  datasetId: "datago-air-station",
  title: "측정소별 실시간 대기측정정보",
  description: "설명",
  sources: [{ provider: "datago", dataset: "air_station", params: {} }],
  exports: [{ format: "jsonl" }],
  metadata: { outputPath: "artifacts/builds/station" },
};

beforeEach(() => clearBuildSpecs());
afterEach(() => clearBuildSpecs());

function next() {
  fireEvent.click(screen.getByRole("button", { name: "다음" }));
}

async function openOutputStep() {
  saveBuildSpec(RUN_ID, SPEC);
  render(
    <MemoryRouter initialEntries={[`/refresh-jobs/${RUN_ID}/edit`]}>
      <Routes>
        <Route path="/refresh-jobs/:buildId/edit" element={<NewBuildPage />} />
      </Routes>
    </MemoryRouter>,
  );
  await screen.findByRole("heading", { name: "기본 정보" }, { timeout: 8000 });
  for (const heading of ["데이터 소스", "파라미터", "미리보기", "출력 형식"]) {
    next();
    await screen.findByRole("heading", { name: heading });
  }
}

describe("the output path Builder would refuse (kpubdata-builder#1320)", () => {
  it("stays on the output step and says why, for a path that leaves the run's folder", async () => {
    await openOutputStep();
    fireEvent.change(screen.getByLabelText(/출력 경로/), { target: { value: "../station" } });
    next();

    expect(await screen.findByText(/1번째 내보내기의 출력 경로는 쓸 수 없습니다/)).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "검증·실행" })).not.toBeInTheDocument();
  });

  it("goes on with two formats, since each gets its own path", async () => {
    await openOutputStep();
    fireEvent.click(screen.getByRole("checkbox", { name: /huggingface/i }));
    next();

    expect(await screen.findByRole("heading", { name: "검증·실행" })).toBeInTheDocument();
  });
});
