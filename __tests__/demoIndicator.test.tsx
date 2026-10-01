/**
 * Demo mode stays visible while browsing, not only at login (#672).
 *
 * Providers, Admin and Catalog read like a real deployment's state; in mock mode the
 * shell's top bar says DEMO on every screen. With the real Builder it says nothing.
 */
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Layout } from "@/app/Layout";
import { resetAdminCheck } from "@/features/admin/store";
import { useUIStore } from "@/shared/hooks/useUIStore";
import { i18n } from "@/shared/i18n";

function renderShell() {
  return render(
    <MemoryRouter initialEntries={["/"]}>
      <Routes>
        <Route element={<Layout />}>
          <Route element={<p>home page</p>} index />
          <Route element={<p>connections page</p>} path="connections" />
          <Route element={<p>settings page</p>} path="settings" />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  act(() => useUIStore.setState({ theme: "light", isMobileSidebarOpen: false, isAssistantDrawerOpen: false }));
  resetAdminCheck();
});

afterEach(() => vi.unstubAllEnvs());

describe("demo-mode indicator (#672)", () => {
  it("stays in the top bar on every screen in mock mode", () => {
    vi.stubEnv("VITE_USE_REAL_BUILDER", "false");
    renderShell();
    const header = screen.getByRole("banner");

    for (const [link, page] of [
      [i18n.t("nav.provider"), "connections page"],
      [i18n.t("nav.settings"), "settings page"],
    ]) {
      fireEvent.click(screen.getByRole("link", { name: link }));
      expect(screen.getByText(page)).toBeInTheDocument();
      const indicator = within(header).getByTestId("demo-indicator");
      expect(indicator).toHaveTextContent("DEMO");
      expect(indicator).toHaveTextContent(i18n.t("layout.demoModeDesc"));
    }
  });

  it("is absent with the real Builder", () => {
    vi.stubEnv("VITE_USE_REAL_BUILDER", "true");
    renderShell();
    expect(screen.queryByTestId("demo-indicator")).not.toBeInTheDocument();
    expect(within(screen.getByRole("banner")).queryByText("DEMO")).not.toBeInTheDocument();
  });
});
