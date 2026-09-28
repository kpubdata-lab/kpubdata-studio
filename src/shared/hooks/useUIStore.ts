/**
 * UI global state store reused throughout the app shell.
 *
 * Mobile sidebar overlay open state, desktop sidebar collapsed state, global Assistant drawer
 * open state, and visual state like theme selection that must persist across page
 * navigation. Mobile overlay and desktop collapse are separate layout concepts, so
 * state is kept separate — mobile overlay opened on mobile should not affect desktop
 * collapse or vice versa (#247).
 *
 * Values persisted to localStorage via `persist` middleware are theme (#83) and
 * desktop collapse preference (#247) only. Mobile overlay open state is intentionally
 * not saved, so it does not restore in a dangling-open state after refresh (always
 * starts closed).
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
  /** Whether the global Assistant drawer is open (#247) (#247) */
  isAssistantDrawerOpen: boolean;
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
  /** Action to open Assistant drawer */
  openAssistantDrawer: () => void;
  /** Action to close Assistant drawer */
  closeAssistantDrawer: () => void;
  /** Action to toggle Assistant drawer open/closed state */
  toggleAssistantDrawer: () => void;
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
      isAssistantDrawerOpen: false,
      theme: "system",
      toggleMobileSidebar: () =>
        set((state) => ({ isMobileSidebarOpen: !state.isMobileSidebarOpen })),
      openMobileSidebar: () => set({ isMobileSidebarOpen: true }),
      closeMobileSidebar: () => set({ isMobileSidebarOpen: false }),
      toggleDesktopSidebarCollapsed: () =>
        set((state) => ({ isDesktopSidebarCollapsed: !state.isDesktopSidebarCollapsed })),
      openAssistantDrawer: () => set({ isAssistantDrawerOpen: true }),
      closeAssistantDrawer: () => set({ isAssistantDrawerOpen: false }),
      toggleAssistantDrawer: () => set((state) => ({ isAssistantDrawerOpen: !state.isAssistantDrawerOpen })),
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
