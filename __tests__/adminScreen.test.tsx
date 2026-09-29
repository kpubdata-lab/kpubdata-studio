/**
 * Administration (#409): the menu follows the Engine's answer, the page shows the
 * Engine's 403 rather than relying on being hidden, and no credential reaches the screen.
 */
import { act, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { http, HttpResponse } from "msw";

import { mswServer } from "../vitest.setup";
import { Layout } from "@/app/Layout";
import { API_BASE } from "@/shared/config/env";
import { AdminPage } from "@/pages/AdminPage";
import { resetAdminCheck, useAdminStore } from "@/features/admin/store";
import { useUIStore } from "@/shared/hooks/useUIStore";

const CONFIG = { enforce_ownership: true, publish_server_credential_fallback: false };
const RUNS = {
  count: 1,
  runs: [{ run_id: "run-42", status: "succeeded", started_at: null, finished_at: null, owner_id: "9f8e7d6c5b4a39281706" }],
};

function answerConfig(status: number, body: Record<string, unknown> = CONFIG) {
  mswServer.use(http.get(`${API_BASE}/admin/config`, () => HttpResponse.json(body as Record<string, never>, { status })));
}

function renderShell() {
  return render(
    <MemoryRouter initialEntries={["/"]}>
      <Layout />
    </MemoryRouter>,
  );
}

function menu() {
  return within(screen.getByRole("navigation", { name: "주 메뉴" }));
}

beforeEach(() => {
  vi.stubEnv("VITE_USE_REAL_BUILDER", "true");
  resetAdminCheck();
  act(() => useUIStore.setState({ theme: "light", isMobileSidebarOpen: false, isAssistantDrawerOpen: false }));
});
afterEach(() => vi.unstubAllEnvs());

describe("administration menu (#409)", () => {
  it("appears for an administrator", async () => {
    answerConfig(200);
    renderShell();
    expect(await menu().findByRole("link", { name: "관리" })).toHaveAttribute("href", "/admin");
  });

  it("does not appear when the Engine answers 403", async () => {
    answerConfig(403, { error: "forbidden" });
    renderShell();
    await waitFor(() => expect(useAdminStore.getState().status).toBe("not_admin"));
    expect(menu().queryByRole("link", { name: "관리" })).not.toBeInTheDocument();
  });

  it.each([404, 500])("stays hidden when the answer is %i — unknown is not admin", async (status) => {
    answerConfig(status, { error: "x" });
    renderShell();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(useAdminStore.getState().status).toBe("unknown");
    expect(menu().queryByRole("link", { name: "관리" })).not.toBeInTheDocument();
  });
});

describe("administration page (#409)", () => {
  function renderPage() {
    return render(
      <MemoryRouter initialEntries={["/admin"]}>
        <Routes>
          <Route element={<AdminPage />} path="/admin" />
        </Routes>
      </MemoryRouter>,
    );
  }

  it("shows the policy in force and every owner's runs, owner as a short hash", async () => {
    answerConfig(200);
    mswServer.use(http.get(`${API_BASE}/admin/runs`, () => HttpResponse.json(RUNS)));
    renderPage();
    expect(await screen.findByText("run-42")).toBeInTheDocument();
    expect(screen.getByText("ENFORCE_OWNERSHIP").nextSibling).toHaveTextContent("켜짐");
    expect(screen.getByText("9f8e7d6c5b4a")).toBeInTheDocument();
    expect(screen.queryByText("9f8e7d6c5b4a39281706")).not.toBeInTheDocument();
  });

  it("shows the Engine's 403 when reached by URL, instead of an empty page", async () => {
    answerConfig(403, { error: "forbidden" });
    mswServer.use(http.get(`${API_BASE}/admin/runs`, () => HttpResponse.json({ error: "forbidden" }, { status: 403 })));
    renderPage();
    expect(await screen.findByRole("alert")).toHaveTextContent("관리자가 아닙니다");
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("never displays a credential, even if an Engine sent one", async () => {
    answerConfig(200, { ...CONFIG, publish_token: "hf_SECRET_VALUE" });
    mswServer.use(http.get(`${API_BASE}/admin/runs`, () => HttpResponse.json(RUNS)));
    renderPage();
    await screen.findByText("run-42");
    expect(document.body.textContent).not.toContain("hf_SECRET_VALUE");
  });
});
