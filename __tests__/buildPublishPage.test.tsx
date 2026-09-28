import { render, screen } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BuildPublishPage } from "@/pages/BuildPublishPage";
import { API_BASE } from "@/shared/config/env";
import { mswServer } from "../vitest.setup";

// builderApi가 실제로 쓰는 API base와 동일하게 파생한다(하드코딩된 host에 종속되지 않도록).
const BUILDER_BASE = API_BASE;

afterEach(() => vi.unstubAllEnvs());

function renderPublish(runId: string) {
  return render(
    <MemoryRouter initialEntries={[`/builds/${runId}/publish`]}>
      <Routes>
        <Route path="/builds/:buildId/publish" element={<BuildPublishPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("BuildPublishPage readiness (audit #4)", () => {
  it("mock 모드에서 실제 네트워크 요청 없이 결정적 readiness를 보여준다 (이전에는 항상 빈 카드/error였다)", async () => {
    renderPublish("air-quality-20260621");

    expect(await screen.findByText("Builder 게시 준비 완료")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("mock 모드에서 not-ready run은 실제 blocker 내용을 보여준다", async () => {
    renderPublish("dur-older-adult-caution-20260618");

    expect(await screen.findByText("Builder blocker가 있어 게시할 수 없습니다.")).toBeInTheDocument();
    expect(screen.getByText(/Bronze stage가 실패해/)).toBeInTheDocument();
  });

  it("?dataset= 없이 exact run_id만으로 들어와도 Dataset identity와 Build 완료를 표시한다", async () => {
    // 이전에는 URL에 ?dataset=이 없으면 Dataset/Build 완료가 "확인되지 않음"이었다
    // (Builds/Runs·Artifacts·딥링크 진입 경로 전부). 이제 canonical run 해석으로 채운다.
    renderPublish("air-quality-20260621");

    const runCard = (await screen.findByText("선택한 Run")).closest("div");
    expect(runCard).toHaveTextContent("대기오염 정보");
    expect(runCard).toHaveTextContent("완료");
    expect(runCard).not.toHaveTextContent("확인되지 않음");
  });

  it("Run마다 자기 Dataset identity를 표시하고 다른 Run과 섞이지 않는다", async () => {
    renderPublish("dur-older-adult-caution-20260618");

    const runCard = (await screen.findByText("선택한 Run")).closest("div");
    expect(runCard).toHaveTextContent("노인주의 의약품");
    expect(runCard).not.toHaveTextContent("대기오염 정보");
    expect(runCard).toHaveTextContent("dur-older-adult-caution-20260618");
  });

  it("ready:false인데 blockers가 비어 있으면 'blocker가 있다'고 잘못 단정하지 않는다", async () => {
    vi.stubEnv("VITE_USE_REAL_BUILDER", "true");
    mswServer.use(
      http.get(`${BUILDER_BASE}/builds/:runId/publish/readiness`, ({ params }) =>
        HttpResponse.json({
          run_id: String(params.runId),
          target: "huggingface",
          ready: false,
          blockers: [],
          warnings: [],
        }),
      ),
    );

    renderPublish("some-real-run");

    expect(
      await screen.findByText(/구체적인 사유\(blocker\)를 제공하지 않았습니다/),
    ).toBeInTheDocument();
    expect(screen.queryByText("Builder blocker가 있어 게시할 수 없습니다.")).not.toBeInTheDocument();
  });
});


describe("BuildPublishPage credential blockers (#399)", () => {
  function readinessWith(code: string, message: string) {
    // 실제 Builder 모드로 둔다. mock 모드에서는 알려진 mock run id 만 해석되어
    // "선택한 Run을 Builder에서 찾을 수 없습니다"로 단락되고, readiness 카드가
    // 아예 렌더되지 않는다.
    vi.stubEnv("VITE_USE_REAL_BUILDER", "true");
    return http.get(`${BUILDER_BASE}/builds/:runId/publish/readiness`, ({ params }) =>
      HttpResponse.json({
        run_id: String(params.runId),
        target: "huggingface",
        ready: false,
        blockers: [{ code, message }],
        warnings: [],
      }),
    );
  }

  it("credential_unavailable 에 credential 안내를 보여준다", async () => {
    mswServer.use(readinessWith("credential_unavailable", "no credential is available"));

    renderPublish("run-no-credential");

    expect(await screen.findByText(/publish 대상\(Hugging Face\/Kaggle\) credential/)).toBeInTheDocument();
  });

  it("credential_required 에는 본인 credential 저장 안내까지 보여준다", async () => {
    // credential_required 는 "어디에도 없다"가 아니라 "이 배포는 서버 것을 빌려주지
    // 않는다"다 (kpubdata-builder #665). 사용자가 직접 할 수 있는 조치가 있으므로
    // 그 조치를 알려주지 않으면 서버 문제로 읽힌다.
    mswServer.use(
      readinessWith("credential_required", "requires a credential stored for this principal"),
    );

    renderPublish("run-needs-own-credential");

    expect(await screen.findByText(/서버 publish credential을 빌려주지 않습니다/)).toBeInTheDocument();
    expect(screen.getByText(/publish 대상\(Hugging Face\/Kaggle\) credential/)).toBeInTheDocument();
  });

  it("credential 과 무관한 blocker 에는 credential 안내를 보여주지 않는다", async () => {
    mswServer.use(readinessWith("run_not_completed", "still running"));

    renderPublish("run-still-running");

    expect(await screen.findByText("Builder blocker가 있어 게시할 수 없습니다.")).toBeInTheDocument();
    expect(screen.queryByText(/publish 대상\(Hugging Face\/Kaggle\) credential/)).not.toBeInTheDocument();
    expect(screen.queryByText(/서버 publish credential을 빌려주지 않습니다/)).not.toBeInTheDocument();
  });
});
