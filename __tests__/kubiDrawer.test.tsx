import { act, fireEvent, render, screen, within } from "@testing-library/react";
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

describe("global Ask KPubData drawer (#247)", () => {
  beforeEach(() => {
    // jsdom에는 matchMedia가 없으므로 system 테마 분기를 피하도록 light로 고정한다.
    act(() =>
      useUIStore.setState({ theme: "light", isMobileSidebarOpen: false, isKubiDrawerOpen: false }),
    );
  });

  it("is closed by default and opens from the topbar Ask KPubData button", () => {
    renderLayoutAt("/");
    expect(screen.queryByRole("dialog", { name: "Ask KPubData" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Ask KPubData 열기" }));

    expect(screen.getByRole("dialog", { name: "Ask KPubData" })).toBeInTheDocument();
  });

  it("shows the current screen's context label", () => {
    renderLayoutAt("/quality");
    fireEvent.click(screen.getByRole("button", { name: "Ask KPubData 열기" }));

    const dialog = screen.getByRole("dialog", { name: "Ask KPubData" });
    // PAGE는 프로토타입처럼 grid cell이 아니라 보조 캡션으로만 표시된다(#256 review).
    expect(within(dialog).getByText(/현재 Context · Quality/)).toBeInTheDocument();
    // context bar는 프로토타입 구조(DATASET/RUN/STAGE/QUALITY)를 따른다.
    expect(within(dialog).getByText("DATASET")).toBeInTheDocument();
    expect(within(dialog).getByText("QUALITY")).toBeInTheDocument();
  });

  it("closes on Escape", () => {
    renderLayoutAt("/");
    fireEvent.click(screen.getByRole("button", { name: "Ask KPubData 열기" }));
    expect(screen.getByRole("dialog", { name: "Ask KPubData" })).toBeInTheDocument();

    fireEvent.keyDown(document, { key: "Escape" });

    expect(screen.queryByRole("dialog", { name: "Ask KPubData" })).not.toBeInTheDocument();
  });

  it("traps keyboard focus and restores it to the opener when closed", () => {
    renderLayoutAt("/");
    const openButton = screen.getByRole("button", { name: "Ask KPubData 열기" });
    openButton.focus();
    fireEvent.click(openButton);

    // overlay는 접근성 트리에서 제외되므로 header X 버튼이 유일한 "Ask KPubData 닫기"다.
    const drawerCloseButton = screen.getByRole("button", { name: "Ask KPubData 닫기" });
    expect(drawerCloseButton).toHaveFocus();

    fireEvent.keyDown(document, { key: "Tab" });
    expect(drawerCloseButton).toHaveFocus();

    fireEvent.click(drawerCloseButton);
    expect(openButton).toHaveFocus();
  });

  it("closes via the click-only overlay and the header close button", () => {
    renderLayoutAt("/");

    fireEvent.click(screen.getByRole("button", { name: "Ask KPubData 열기" }));
    // overlay는 aria-hidden이라 role 질의에 잡히지 않는다.
    expect(screen.queryAllByRole("button", { name: "Ask KPubData 닫기" })).toHaveLength(1);

    fireEvent.click(screen.getByTestId("kubi-drawer-overlay"));
    expect(screen.queryByRole("dialog", { name: "Ask KPubData" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Ask KPubData 열기" }));
    fireEvent.click(screen.getByRole("button", { name: "Ask KPubData 닫기" }));
    expect(screen.queryByRole("dialog", { name: "Ask KPubData" })).not.toBeInTheDocument();
  });

  it("opens the drawer when the topbar search is submitted", () => {
    renderLayoutAt("/");
    const searchInput = screen.getByLabelText("Ask KPubData 에 자연어로 데이터 물어보기");
    fireEvent.change(searchInput, { target: { value: "서울 대기오염 데이터셋 찾아줘" } });
    fireEvent.submit(searchInput.closest("form")!);

    expect(screen.getByRole("dialog", { name: "Ask KPubData" })).toBeInTheDocument();
  });
});
