// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { useUIStore } from "@/shared/hooks/useUIStore";

describe("useUIStore", () => {
  beforeEach(() => {
    localStorage.clear();
    useUIStore.setState({
      isMobileSidebarOpen: false,
      isDesktopSidebarCollapsed: false,
      theme: "system",
    });
  });

  it("toggles the mobile sidebar overlay state", () => {
    useUIStore.getState().toggleMobileSidebar();
    expect(useUIStore.getState().isMobileSidebarOpen).toBe(true);

    useUIStore.getState().toggleMobileSidebar();
    expect(useUIStore.getState().isMobileSidebarOpen).toBe(false);
  });

  it("toggles the desktop sidebar collapsed state", () => {
    useUIStore.getState().toggleDesktopSidebarCollapsed();
    expect(useUIStore.getState().isDesktopSidebarCollapsed).toBe(true);

    useUIStore.getState().toggleDesktopSidebarCollapsed();
    expect(useUIStore.getState().isDesktopSidebarCollapsed).toBe(false);
  });

  it("keeps mobile overlay and desktop collapse state independent of each other (#247)", () => {
    useUIStore.getState().openMobileSidebar();
    useUIStore.getState().toggleDesktopSidebarCollapsed();

    expect(useUIStore.getState().isMobileSidebarOpen).toBe(true);
    expect(useUIStore.getState().isDesktopSidebarCollapsed).toBe(true);

    // 모바일 오버레이를 닫아도 데스크톱 collapse 선호는 영향받지 않는다.
    useUIStore.getState().closeMobileSidebar();
    expect(useUIStore.getState().isMobileSidebarOpen).toBe(false);
    expect(useUIStore.getState().isDesktopSidebarCollapsed).toBe(true);

    // 데스크톱을 다시 펼쳐도 모바일 오버레이는 열리지 않는다.
    useUIStore.getState().toggleDesktopSidebarCollapsed();
    expect(useUIStore.getState().isDesktopSidebarCollapsed).toBe(false);
    expect(useUIStore.getState().isMobileSidebarOpen).toBe(false);
  });

  it("persists the theme and desktop collapse preference to localStorage (#83, #247)", () => {
    useUIStore.getState().setTheme("dark");
    useUIStore.getState().toggleDesktopSidebarCollapsed();

    const persisted = JSON.parse(localStorage.getItem("kpubdata-studio:ui") ?? "{}");
    expect(persisted.state.theme).toBe("dark");
    expect(persisted.state.isDesktopSidebarCollapsed).toBe(true);
  });

  it("never persists the mobile overlay open state (#247)", () => {
    useUIStore.getState().openMobileSidebar();

    const persisted = JSON.parse(localStorage.getItem("kpubdata-studio:ui") ?? "{}");
    // 사이드바 오버레이 상태는 저장하지 않는다(새로고침 후 모바일 메뉴가 열린 채 복원되는 것 방지).
    expect(persisted.state.isMobileSidebarOpen).toBeUndefined();
  });
});
