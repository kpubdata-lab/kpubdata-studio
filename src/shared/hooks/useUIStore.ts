/**
 * UI global state store reused throughout the app shell.
 *
 * Mobile sidebar overlay open state, desktop sidebar collapsed state, global Kubi drawer 열림 여부,
 * 테마 선택처럼 페이지를 넘나들며 유지해야 하는 시각 상태를 관리한다. 모바일 오버레이와 데스크톱
 * collapse는 서로 다른 레이아웃 개념이라 상태를 분리한다 — 모바일에서 열어둔 오버레이가 데스크톱
 * collapse에 영향을 주거나, 그 반대가 되어서는 안 된다(#247).
 *
 * `persist` 미들웨어로 localStorage에 저장하는 값은 테마(#83)와 데스크톱 collapse 선호(#247)뿐이다.
 * 모바일 오버레이 열림 상태는 의도적으로 저장하지 않아, 새로고침 후 모바일 metadata)뉴가 열린 채로
 * 되살아나지 않는다(항상 닫힌 상태로 시작).
 */
import { create } from "zustand";
import { persist } from "zustand/middleware";

/** Set of theme modes currently supported by Studio shell */
export type ThemeMode = "system" | "light" | "dark";

interface UIState {
  /** Whether sidebar overlay is open in mobile/tablet layout (not persisted) */
  isMobileSidebarOpen: boolean;
  /** Whether sidebar is collapsed in desktop layout (can be persisted, #247) */
  isDesktopSidebarCollapsed: boolean;
  /** Whether the global Kubi drawer is open (#247) (#247) */
  isKubiDrawerOpen: boolean;
  /** The theme mode selected by the user */
  theme: ThemeMode;
  /** Action to toggle mobile sidebar overlay open/closed state */
  toggleMobileSidebar: () => void;
  /** Action to force open the mobile sidebar overlay */
  openMobileSidebar: () => void;
  /** Action to force close the mobile sidebar overlay */
  closeMobileSidebar: () => void;
  /** Action to toggle desktop sidebar collapsed/expanded state */
  toggleDesktopSidebarCollapsed: () => void;
  /** Action to open Kubi drawer */
  openKubiDrawer: () => void;
  /** Action to close Kubi drawer */
  closeKubiDrawer: () => void;
  /** Action to toggle Kubi drawer open/closed state */
  toggleKubiDrawer: () => void;
  /** Action to update theme mode to a new value */
  setTheme: (theme: ThemeMode) => void;
}

/**
 * Zustand hook to read and update common layout UI state.
 *
 * @returns Current UI state and actions to modify state.
 */
export const useUIStore = create<UIState>()(
  persist(
    (set) => ({
      isMobileSidebarOpen: false,
      isDesktopSidebarCollapsed: false,
      isKubiDrawerOpen: false,
      theme: "system",
      toggleMobileSidebar: () =>
        set((state) => ({ isMobileSidebarOpen: !state.isMobileSidebarOpen })),
      openMobileSidebar: () => set({ isMobileSidebarOpen: true }),
      closeMobileSidebar: () => set({ isMobileSidebarOpen: false }),
      toggleDesktopSidebarCollapsed: () =>
        set((state) => ({ isDesktopSidebarCollapsed: !state.isDesktopSidebarCollapsed })),
      openKubiDrawer: () => set({ isKubiDrawerOpen: true }),
      closeKubiDrawer: () => set({ isKubiDrawerOpen: false }),
      toggleKubiDrawer: () => set((state) => ({ isKubiDrawerOpen: !state.isKubiDrawerOpen })),
      setTheme: (theme) => set({ theme }),
    }),
    {
      name: "kpubdata-studio:ui",
      // Save only theme and desktop collapse preference. Mobile overlay state is not saved, so
      // it always starts closed on refresh (independent of desktop collapse restoration).
      partialize: (state) => ({
        theme: state.theme,
        isDesktopSidebarCollapsed: state.isDesktopSidebarCollapsed,
      }),
    },
  ),
);
