import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { BuildRunPage } from "@/pages/BuildRunPage";

function renderRun(buildId: string) {
  return render(
    <MemoryRouter initialEntries={[`/refresh-jobs/${buildId}/run`]}>
      <Routes>
        <Route path="/refresh-jobs/:buildId/run" element={<BuildRunPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("BuildRunPage (audit #3)", () => {
  it("shows the build's actual canonical status (running), not a hardcoded 대기 placeholder", async () => {
    // dur-pregnancy-taboo-20260621는 mock 빌드 이력에서 status: "running"이다 — Builds
    // 목록에서 running으로 보이는 run을 열었을 때 이 화면이 항상 "대기"로 보이던 모순을 재현한다.
    renderRun("dur-pregnancy-taboo-20260621");

    expect(await screen.findByText("실행 중")).toBeInTheDocument();
    expect(screen.queryByText("대기 중")).not.toBeInTheDocument();
  });

  it("shows the build's actual canonical status (failed), not a hardcoded 대기 placeholder", async () => {
    renderRun("dur-older-adult-caution-20260618");

    expect(await screen.findByText("실패")).toBeInTheDocument();
    expect(screen.queryByText("대기 중")).not.toBeInTheDocument();
  });

  it("does not fabricate stage-by-stage progress, and does not claim the API is unsupported", async () => {
    renderRun("dur-pregnancy-taboo-20260621");

    await screen.findByText("실행 중");
    // 사실과 다른 "미지원" 문구는 없다.
    expect(screen.queryByText(/미지원/)).not.toBeInTheDocument();
    expect(screen.queryByText(/아직 제공하지 않습니다/)).not.toBeInTheDocument();
    // 대신 canonical Build 상세로 안내한다.
    expect(screen.getByText("상세 진행은 Run 상세에서 확인하세요")).toBeInTheDocument();
  });

  it("routes to the canonical Build detail and keeps deep links", async () => {
    renderRun("dur-pregnancy-taboo-20260621");
    await screen.findByText("실행 중");

    const detailLinks = screen
      .getAllByRole("link")
      .filter((a) => a.getAttribute("href")?.startsWith("/refresh-jobs?run="));
    expect(detailLinks.length).toBeGreaterThan(0);
    // legacy 화면에 항상-disabled 가짜 취소 버튼은 없다.
    expect(screen.queryByRole("button", { name: "취소" })).not.toBeInTheDocument();
  });
});
