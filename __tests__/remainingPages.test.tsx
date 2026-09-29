import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { ArtifactsPage } from "@/pages/ArtifactsPage";
import { BuildsPage } from "@/pages/BuildsPage";
import { PreviewPage } from "@/pages/PreviewPage";
import { SettingsPage } from "@/pages/SettingsPage";
import { ValidatePage } from "@/pages/ValidatePage";

function renderPage(element: ReactNode) {
  return render(<MemoryRouter>{element}</MemoryRouter>);
}

describe("remaining pages", () => {
  it("BuildsPage shows the Korean heading and loads run history (#255 master-detail)", async () => {
    renderPage(<BuildsPage />);
    expect(screen.getByRole("heading", { name: "실행 이력" })).toBeInTheDocument();
    // mock 실행 이력이 로드된다.
    expect(await screen.findByText("대기오염 정보")).toBeInTheDocument();
  });

  it("SettingsPage shows the API base URL section", () => {
    renderPage(<SettingsPage />);
    expect(screen.getByRole("heading", { name: "환경 설정" })).toBeInTheDocument();
    expect(screen.getByText("Engine API base URL")).toBeInTheDocument();
  });

  it("ArtifactsPage guides to the build list", () => {
    renderPage(<ArtifactsPage />);
    expect(screen.getByRole("link", { name: "실행 목록으로" })).toHaveAttribute("href", "/builds");
  });

  it("legacy Validate/Preview pages route into the wizard", () => {
    renderPage(<ValidatePage />);
    expect(screen.getByRole("link", { name: "테이블 만들기" })).toHaveAttribute(
      "href",
      "/builds/new",
    );
    renderPage(<PreviewPage />);
    expect(screen.getAllByRole("link", { name: "테이블 만들기" }).length).toBeGreaterThanOrEqual(1);
  });
});
