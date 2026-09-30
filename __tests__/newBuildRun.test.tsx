import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { clearBuildSpecs, saveBuildSpec } from "@/features/build-spec/specStore";
import { NewBuildPage } from "@/pages/NewBuildPage";

const RUN_ID = "air-quality-edit-run";

beforeEach(() => {
  clearBuildSpecs();
  saveBuildSpec(RUN_ID, {
    datasetId: "air-quality",
    title: "대기오염",
    description: "설명",
    sources: [{ provider: "datago", dataset: "air", params: {} }],
    exports: [{ format: "jsonl" }],
    metadata: { outputPath: "artifacts/builds/air-quality" },
  });
});

afterEach(() => clearBuildSpecs());

function next() {
  fireEvent.click(screen.getByRole("button", { name: "다음" }));
}

async function goToReviewAndValidate() {
  // Editing an existing table's spec (#534 — creating one is /add).
  render(
    <MemoryRouter initialEntries={[`/refresh-jobs/${RUN_ID}/edit`]}>
      <Routes>
        <Route path="/refresh-jobs/:buildId/edit" element={<NewBuildPage />} />
      </Routes>
    </MemoryRouter>,
  );
  await screen.findByRole("heading", { name: "기본 정보" }, { timeout: 8000 });
  next(); // → 데이터 소스
  await screen.findByRole("heading", { name: "데이터 소스" });
  next(); // → 파라미터 (기본 "{}" 유효)
  await screen.findByRole("heading", { name: "파라미터" });
  next(); // → 미리보기
  await screen.findByRole("heading", { name: "미리보기" });
  next(); // → 출력 형식 (기본 jsonl + outputPath)
  await screen.findByRole("heading", { name: "출력 형식" });
  next(); // → 검증·실행
  await screen.findByRole("heading", { name: "검증·실행" });
  fireEvent.click(screen.getByRole("button", { name: "다시 검증" }));
  // mock validateSpec → valid → 빌드 실행 활성화
  await screen.findByText("검증을 통과했습니다. 실행할 수 있습니다.");
}

describe("Spec edit wizard — run build (#39 wiring)", () => {
  it("runs the build (mock) and shows success after validation", async () => {
    await goToReviewAndValidate();

    const runButton = screen.getByRole("button", { name: "갱신" });
    expect(runButton).toBeEnabled();
    fireEvent.click(runButton);

    expect(await screen.findByText(/실행 성공/)).toBeInTheDocument();
  });

  it("resets validation so an edited (unvalidated) spec cannot be run (#72)", async () => {
    await goToReviewAndValidate();
    expect(screen.getByRole("button", { name: "갱신" })).toBeEnabled();

    // 검증 이후 출력 형식 단계로 돌아가 입력을 수정한다.
    fireEvent.click(screen.getByRole("button", { name: "이전" }));
    await screen.findByRole("heading", { name: "출력 형식" });
    fireEvent.change(screen.getByLabelText(/출력 경로/), {
      target: { value: "artifacts/builds/edited" },
    });

    // 검증·실행 단계로 다시 이동하면 검증 결과가 초기화되어 실행이 막혀야 한다.
    fireEvent.click(screen.getByRole("button", { name: "다음" }));
    await screen.findByRole("heading", { name: "검증·실행" });

    expect(screen.queryByText("검증을 통과했습니다. 실행할 수 있습니다.")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "갱신" })).toBeDisabled();
  });
});
