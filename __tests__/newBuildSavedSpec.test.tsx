/**
 * NewBuildPage ↔ Workspace Saved BuildSpec 연동 (#260).
 *
 * Review 단계의 "이 스펙 저장" 버튼이 실제로 savedSpecs 저장소에 기록되는지, 저장 시점의
 * 검증 상태가 함께 기록되는지 확인한다. `?savedSpecId=`로 여는 경로는 /add 로 옮겼다
 * (#534, createTableFlow.test.tsx).
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NewBuildPage } from "@/pages/NewBuildPage";
import { clearBuildSpecs, saveBuildSpec } from "@/features/build-spec/specStore";
import { listSavedSpecSummaries } from "@/features/workspace/savedSpecs";

const RUN_ID = "air-quality-edit-run";

function next() {
  fireEvent.click(screen.getByRole("button", { name: "다음" }));
}

// Saving a spec to Workspace stays on the spec edit page; opening one is /add now (#534,
// createTableFlow.test.tsx).
async function goToReviewAndValidate() {
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
  next();
  await screen.findByRole("heading", { name: "검증·실행" });
  fireEvent.click(screen.getByRole("button", { name: "다시 검증" }));
  await screen.findByText("검증을 통과했습니다. 실행할 수 있습니다.");
}

beforeEach(() => {
  localStorage.clear();
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

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe("이 스펙 저장 (Review 단계)", () => {
  it("prompts for a name and stores the spec with the current validated_pass status", async () => {
    vi.spyOn(window, "prompt").mockReturnValue("내 대기오염 스펙");
    await goToReviewAndValidate();

    fireEvent.click(screen.getByRole("button", { name: "이 스펙 저장 (작업대)" }));

    expect(await screen.findByText(/내 대기오염 스펙.*작업대에 저장했습니다/)).toBeInTheDocument();
    const summaries = listSavedSpecSummaries();
    expect(summaries).toHaveLength(1);
    expect(summaries[0]).toMatchObject({ name: "내 대기오염 스펙", provider: "datago", validationStatus: "validated_pass" });
  });

  it("records not_validated when the user saves before running validation", async () => {
    vi.spyOn(window, "prompt").mockReturnValue("검증 전 저장");
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
    next();
    await screen.findByRole("heading", { name: "검증·실행" });
    // "다시 검증"을 누르지 않고 바로 저장한다.

    fireEvent.click(screen.getByRole("button", { name: "이 스펙 저장 (작업대)" }));

    await screen.findByText(/작업대에 저장했습니다/);
    expect(listSavedSpecSummaries()[0].validationStatus).toBe("not_validated");
  });

  it("does not save when the user cancels the name prompt", async () => {
    vi.spyOn(window, "prompt").mockReturnValue(null);
    await goToReviewAndValidate();

    fireEvent.click(screen.getByRole("button", { name: "이 스펙 저장 (작업대)" }));

    expect(listSavedSpecSummaries()).toHaveLength(0);
  });

  it("shows the save-failure reason when the storage layer rejects the save", async () => {
    vi.spyOn(window, "prompt").mockReturnValue("실패할 저장");
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("quota exceeded", "QuotaExceededError");
    });
    await goToReviewAndValidate();

    fireEvent.click(screen.getByRole("button", { name: "이 스펙 저장 (작업대)" }));

    expect(await screen.findByText(/저장 공간이 부족합니다/)).toBeInTheDocument();
  });
});
