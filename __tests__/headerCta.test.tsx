import { act, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it } from "vitest";
import { Layout } from "@/app/Layout";
import { useUIStore } from "@/shared/hooks/useUIStore";

function renderLayoutAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Layout />
    </MemoryRouter>,
  );
}

describe("Layout header CTA (#49)", () => {
  beforeEach(() => {
    // jsdom에 matchMedia가 없으므로 system 분기를 피하도록 light로 고정한다.
    act(() =>
      useUIStore.setState({
        theme: "light",
        isMobileSidebarOpen: false,
        isKubiDrawerOpen: false,
      }),
    );
  });

  it("links to New Build from the dashboard", () => {
    renderLayoutAt("/");
    expect(screen.getByRole("link", { name: "새 빌드 만들기" })).toHaveAttribute(
      "href",
      "/builds/new",
    );
  });

  it("switches the CTA to the builds list while on the New Build page", () => {
    renderLayoutAt("/builds/new");
    const cta = screen.getByRole("link", { name: "빌드 목록" });
    expect(cta).toHaveAttribute("href", "/builds");
    expect(screen.queryByRole("link", { name: "새 빌드 만들기" })).not.toBeInTheDocument();
  });

  it("offers '결과물 보기' from a run page", () => {
    renderLayoutAt("/builds/run-1/run");
    expect(screen.getByRole("link", { name: "결과물 보기" })).toHaveAttribute(
      "href",
      "/builds/run-1/artifacts",
    );
  });
});
