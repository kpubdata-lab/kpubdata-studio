/**
 * Every app page has exactly one `<h1>` (#485).
 *
 * The page header used to be an `<h2>` and the topbar a breadcrumb `<nav>`, so no app
 * page had a top-level heading. Each route is mounted through the app's own route tree,
 * as the browser would reach it, and the count is taken once the page has settled.
 */
import { act, render, waitFor } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { appRoutes } from "@/app/router";
import { useUIStore } from "@/shared/hooks/useUIStore";

const PATHS = [
  "/",
  "/discover",
  "/add",
  "/tables",
  "/tables/air-quality",
  "/sql",
  "/workspace",
  "/reports",
  "/reports/does-not-exist",
  "/assistant",
  "/refresh-jobs",
  "/refresh-jobs/new",
  "/refresh-jobs/run-1",
  "/refresh-jobs/run-1/run",
  "/refresh-jobs/run-1/artifacts",
  "/refresh-jobs/run-1/publish",
  "/quality",
  "/monitoring",
  "/connections",
  "/settings",
  "/admin",
  "/validate",
  "/preview",
  "/artifacts",
];

beforeEach(() => {
  vi.stubEnv("VITE_USE_REAL_BUILDER", "false");
  act(() => useUIStore.setState({ theme: "light", isMobileSidebarOpen: false, isAssistantDrawerOpen: false }));
});

describe("one h1 per page (#485)", () => {
  it.each(PATHS)("%s", async (path) => {
    const router = createMemoryRouter(appRoutes, { initialEntries: [path] });
    const { container, unmount } = render(<RouterProvider router={router} />);
    await waitFor(() => expect(container.querySelectorAll("h1").length).toBeGreaterThan(0), { timeout: 10_000 });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 100));
    });
    expect([...container.querySelectorAll("h1")].map((h) => h.textContent)).toHaveLength(1);
    unmount();
  });
});
