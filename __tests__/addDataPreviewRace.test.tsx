/**
 * Add Data Workbench — Preview latest-request race 전용 테스트 (#283 후속 리뷰 §4).
 *
 * 실제 `PreviewValidationStep`의 "Preview 새로고침" 버튼은 `preview.status === "loading"`
 * 동안 정상적으로 disabled 처리된다(정당한 UI 안전장치, `Button`의 `loading` prop) —
 * React는 disabled인 DOM 노드의 클릭 리스너를 fiber의 `disabled` prop 기준으로 걸러내므로
 * (disabled DOM 속성을 테스트에서 강제로 바꿔도 무시한다), 그 버튼 자체로는 "이전 요청이
 * 아직 진행 중인데 다음 요청이 시작되는" 순간을 안정적으로 재현할 수 없다.
 *
 * 이 파일은 `AddDataPage`의 실제 `runPreviewAndValidate`(requestId 가드 포함)는 그대로
 * 두고, `PreviewValidationStep`만 항상 클릭 가능한 최소 스텁으로 교체해 그 가드 로직만
 * 독립적으로 검증한다 — 다른 통합 테스트(`addDataWizard.test.tsx`)는 실제 버튼/disabled
 * 동작을 그대로 검증하므로 이 파일과 책임이 겹치지 않는다. draft를 "invalid"로 바꾸는
 * 수단은 이미 있는 "불러오기"(저장된 초안 복원) 흐름을 그대로 쓴다 — step은 그대로 두고
 * draft 전체를 교체하는 유일한 UI 경로다(step 이동 없이 도달 가능).
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { saveAddDataDraft } from "@/features/add-data/draftStorage";
import { INITIAL_DRAFT } from "@/features/add-data/model";
import { AddDataPage } from "@/pages/AddDataPage";
import { API_BASE } from "@/shared/config/env";
import { mswServer } from "../vitest.setup";

vi.mock("@/features/add-data/components/PreviewValidationStep", () => ({
  // 실제 disabled 가드를 우회해 requestId 로직만 독립적으로 노출하는 최소 스텁.
  PreviewValidationStep: (props: { preview: { status: string; error?: string }; onRefresh: () => void }) => (
    <div>
      <h3>미리보기 · 검증 (stub)</h3>
      <button onClick={props.onRefresh}>강제 Preview 새로고침</button>
      {props.preview.status === "error" ? <p>{"Preview 요청에 실패했습니다"}</p> : null}
      {props.preview.status === "error" && props.preview.error ? <p>{props.preview.error}</p> : null}
    </div>
  ),
}));

function renderWizard() {
  return render(
    <MemoryRouter initialEntries={["/add"]}>
      <Routes>
        <Route path="/add" element={<AddDataPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

function next() {
  fireEvent.click(screen.getByRole("button", { name: "다음" }));
}

afterEach(() => {
  vi.unstubAllEnvs();
  localStorage.clear();
});

describe("Add Data Workbench — Preview latest-request race (#283 후속 리뷰 §4)", () => {
  it("A(valid) pending 중 B(invalid)로 바뀌면 B의 local error 상태가 나중에 도착하는 A 응답에 덮이지 않는다", async () => {
    vi.stubEnv("VITE_USE_REAL_BUILDER", "true");
    // "불러오기"로 draft를 통째로 invalid 상태(INITIAL_DRAFT)로 바꿔치기하기 위해
    // 미리 localStorage에 저장해둔다(hasAddDataDraft가 true여야 배너가 뜬다).
    saveAddDataDraft(INITIAL_DRAFT);

    let resolvePreview!: () => void;
    const pendingPreview = new Promise<void>((resolve) => {
      resolvePreview = resolve;
    });
    mswServer.use(
      http.post(`${API_BASE}/preview`, async () => {
        await pendingPreview;
        return HttpResponse.json({ dataset_id: "d", previews: [] });
      }),
      http.post(`${API_BASE}/validate`, async () => {
        await pendingPreview;
        return HttpResponse.json({ status: "valid" });
      }),
    );

    renderWizard();
    expect(screen.getByText("저장된 초안이 있습니다. 이어서 편집할까요?")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /공공 API/ }));
    next();
    await screen.findByLabelText("제공자 (Provider)");
    await screen.findByRole("option", { name: "datago" });
    fireEvent.change(screen.getByLabelText(/제공자 \(Provider\)/), { target: { value: "datago" } });
    await waitFor(() => expect(screen.getByLabelText(/소스 데이터셋 \(Source Dataset\)/)).not.toBeDisabled());
    // 실연동 모드의 기본 MSW catalog handler는 dataset "air_quality"만 제공한다.
    fireEvent.change(screen.getByLabelText(/소스 데이터셋 \(Source Dataset\)/), { target: { value: "air_quality" } });
    next();
    await screen.findByText("미리보기 · 검증 (stub)");

    // A: 유효한 draft로 Preview 요청을 시작한다 — 네트워크가 pendingPreview로 막혀 있어
    // 아직 완료되지 않는다.
    fireEvent.click(screen.getByRole("button", { name: "강제 Preview 새로고침" }));

    // B: "불러오기"로 draft 전체를 invalid(INITIAL_DRAFT)로 바꿔치기한다 — step 이동 없이
    // 그대로 Preview 화면에 머무른 채 draft만 교체된다. 이어서 다시 Preview를 누르면
    // local error로 즉시 return해야 한다(네트워크 요청 없음).
    fireEvent.click(screen.getByRole("button", { name: "불러오기" }));
    fireEvent.click(screen.getByRole("button", { name: "강제 Preview 새로고침" }));

    expect(screen.getByText("Preview 요청에 실패했습니다")).toBeInTheDocument();
    expect(screen.getByText(/Source를 먼저 선택/)).toBeInTheDocument();

    // A가 뒤늦게 완료돼도 B의 error 상태를 덮어써서는 안 된다.
    resolvePreview();
    await pendingPreview;
    await waitFor(() => expect(screen.getByText("Preview 요청에 실패했습니다")).toBeInTheDocument());
    expect(screen.getByText(/Source를 먼저 선택/)).toBeInTheDocument();
  });
});
