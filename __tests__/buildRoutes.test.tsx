import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { BuildArtifactsPage } from "@/pages/BuildArtifactsPage";
import { BuildsPage } from "@/pages/BuildsPage";
import { BuildPublishPage } from "@/pages/BuildPublishPage";
import { BuildRunPage } from "@/pages/BuildRunPage";

function renderAt(path: string, element: React.ReactNode) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/refresh-jobs/:buildId" element={element} />
        <Route path="/refresh-jobs/:buildId/run" element={element} />
        <Route path="/refresh-jobs/:buildId/artifacts" element={element} />
        <Route path="/refresh-jobs/:buildId/publish" element={element} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("build-centric routes", () => {
  it("renders the builds master-detail page with data for the buildId from the legacy route (#255)", async () => {
    // 라우트 파라미터가 실제 조회에 쓰이는지 확인하기 위해 mock 이력에 존재하는 id를 쓴다.
    renderAt("/refresh-jobs/air-quality-20260621", <BuildsPage />);
    // BuildsPage는 비동기로 데이터를 로드하므로 로딩이 완료될 때까지 기다린다.
    await waitFor(() => {
      // 조회된 스펙의 제목이 표시되고,
      expect(screen.getByRole("heading", { name: "대기오염 정보" })).toBeInTheDocument();
    });
    // 어떤 실행인지 식별할 수 있도록 run id도 함께 노출된다(목록과 상세 양쪽에 나타날 수 있다).
    expect(screen.getAllByText(/air-quality-20260621/).length).toBeGreaterThan(0);
    expect(screen.getByRole("link", { name: /편집/ })).toHaveAttribute(
      "href",
      "/refresh-jobs/air-quality-20260621/edit",
    );
  });

  it("shows an explicit not-found state instead of placeholder data for an unknown buildId (#255)", async () => {
    renderAt("/refresh-jobs/does-not-exist", <BuildsPage />);
    // 존재하지 않는 빌드를 실제 데이터처럼 보여주면 안 된다 (#119, #120, #255).
    expect(await screen.findByText(/실행을 찾을 수 없습니다/)).toBeInTheDocument();
  });

  it("renders the run page with the build's actual canonical status, not fake progress steps (UI audit #3)", async () => {
    // 이전에는 buildId와 무관하게 항상 "대기"·가짜 stepper였다 — 실제 mock 이력에 존재하는
    // run(dur-pregnancy-taboo-20260621, status: running)으로 canonical 상태를 확인한다.
    renderAt("/refresh-jobs/dur-pregnancy-taboo-20260621/run", <BuildRunPage />);
    expect(await screen.findByText("실행 중")).toBeInTheDocument();
    expect(screen.getByText("상세 진행은 실행 상세에서 확인하세요")).toBeInTheDocument();
    expect(screen.queryByText(/미지원/)).not.toBeInTheDocument();
  });

  it("renders the artifacts page with a manifest section", async () => {
    renderAt("/refresh-jobs/abc/artifacts", <BuildArtifactsPage />);
    // manifest는 비동기로 로드되므로 로드 후 요약이 나타난다.
    expect(await screen.findByText("매니페스트 요약")).toBeInTheDocument();
    expect(screen.getByText(/12,304/)).toBeInTheDocument();
  });

  it("renders the real publish page with only the supported Hugging Face target", () => {
    renderAt("/refresh-jobs/abc/publish", <BuildPublishPage />);
    expect(screen.getByText("Hugging Face")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "최종 확인" })).toBeDisabled();
    expect(screen.queryByText(/Kaggle|Local only/)).not.toBeInTheDocument();
  });
});
