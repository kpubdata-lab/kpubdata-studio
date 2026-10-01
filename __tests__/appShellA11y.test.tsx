/**
 * App shell accessibility: one main landmark with a skip link (#660), and focus and the
 * document title after a client-side navigation (#662).
 *
 * Every route is mounted through the app's own route tree, as the browser reaches it,
 * so a page that brings its own `<main>` back is caught here.
 */
import { act, fireEvent, render, waitFor } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { appRoutes } from "@/app/router";
import { focusRouteTarget } from "@/app/routeFocus";
import { useUIStore } from "@/shared/hooks/useUIStore";
import { i18n } from "@/shared/i18n";

const PATHS = [
  "/",
  "/discover",
  "/add",
  "/tables",
  "/tables/air-quality",
  "/sql",
  "/analyses",
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

const t = (key: string, options?: Record<string, unknown>) => i18n.t(key, options);

function mount(path: string) {
  const router = createMemoryRouter(appRoutes, { initialEntries: [path] });
  const view = render(<RouterProvider router={router} />);
  return { router, ...view };
}

async function settled(container: HTMLElement) {
  await waitFor(() => expect(container.querySelector("main h1")).not.toBeNull(), { timeout: 10_000 });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 100));
  });
}

beforeEach(() => {
  vi.stubEnv("VITE_USE_REAL_BUILDER", "false");
  act(() => useUIStore.setState({ theme: "light", isMobileSidebarOpen: false, isAssistantDrawerOpen: false }));
});

afterEach(() => {
  (document.activeElement as HTMLElement | null)?.blur();
});

describe("one main landmark per page (#660)", () => {
  it.each(PATHS)("%s", async (path) => {
    const { container, unmount } = mount(path);
    await settled(container);

    const mains = container.querySelectorAll("main, [role='main']");
    expect(mains).toHaveLength(1);
    expect(mains[0].id).toBe("main-content");
    // The page heading is inside the landmark, so "jump to main" lands on the page.
    expect(mains[0].querySelector("h1")).not.toBeNull();
    unmount();
  });
});

describe("skip to content link (#660)", () => {
  it("is the first focusable element and moves focus to main", async () => {
    const { container, unmount } = mount("/");
    await settled(container);

    const first = container.querySelector<HTMLElement>("a[href], button, input, select, textarea, [tabindex]:not([tabindex='-1'])");
    expect(first?.textContent).toBe(t("layout.skipToContent"));
    expect(first?.getAttribute("href")).toBe("#main-content");
    // Hidden until focused.
    expect(first?.className).toContain("sr-only");
    expect(first?.className).toContain("focus:not-sr-only");

    fireEvent.click(first!);
    expect(document.activeElement).toBe(container.querySelector("main"));
    unmount();
  });
});

describe("route change focus and title (#662)", () => {
  it("sets the title on load without taking focus, then focuses the new page's h1 on navigation", async () => {
    const { router, container, unmount } = mount("/");
    await settled(container);

    expect(document.title).toBe(t("layout.documentTitle", { page: t("nav.home") }));
    // A page load is not a navigation: focus stays where the browser put it.
    expect(document.activeElement).toBe(document.body);

    const link = [...container.querySelectorAll<HTMLAnchorElement>("nav a")].find((a) => a.getAttribute("href") === "/settings")!;
    link.focus();
    await act(async () => {
      await router.navigate("/settings");
    });

    await waitFor(() => expect(document.title).toBe(t("layout.documentTitle", { page: t("nav.settings") })));
    await waitFor(() => {
      const heading = container.querySelector("main h1");
      expect(heading).not.toBeNull();
      expect(document.activeElement).toBe(heading);
    });
    expect(document.activeElement?.getAttribute("tabindex")).toBe("-1");
    unmount();
  });

  it("names a nested page from the inside out", async () => {
    const { container, unmount } = mount("/tables/air-quality");
    await settled(container);
    expect(document.title).toBe(t("layout.documentTitle", { page: `air-quality · ${t("nav.datasets")}` }));
    unmount();
  });
});

describe("focusRouteTarget (#662)", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("waits for a lazy page's heading", async () => {
    const main = document.createElement("main");
    document.body.append(main);
    const stop = focusRouteTarget(main);
    const heading = document.createElement("h1");
    main.append(heading);
    await waitFor(() => expect(document.activeElement).toBe(heading));
    stop();
  });

  it("does not take focus back once the user has moved it", async () => {
    const main = document.createElement("main");
    const input = document.createElement("input");
    document.body.append(main, input);
    const stop = focusRouteTarget(main);
    input.focus();
    main.append(document.createElement("h1"));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(document.activeElement).toBe(input);
    stop();
  });

  it("leaves focus inside a dialog alone", async () => {
    const main = document.createElement("main");
    main.append(document.createElement("h1"));
    const dialog = document.createElement("div");
    dialog.setAttribute("role", "dialog");
    const button = document.createElement("button");
    dialog.append(button);
    document.body.append(main, dialog);
    button.focus();
    const stop = focusRouteTarget(main);
    expect(document.activeElement).toBe(button);
    stop();
  });

  it("falls back to main when no heading arrives", () => {
    vi.useFakeTimers();
    try {
      const main = document.createElement("main");
      main.tabIndex = -1;
      document.body.append(main);
      focusRouteTarget(main, 50);
      vi.advanceTimersByTime(60);
      expect(document.activeElement).toBe(main);
    } finally {
      vi.useRealTimers();
    }
  });
});
