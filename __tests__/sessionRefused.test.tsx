/**
 * A session Builder keeps refusing after the token is renewed is explained once (#771).
 *
 * The token is renewed and Builder still answers 401 — an unverified e-mail, a wrong
 * audience. Every screen showed its own "could not load" and every query went on renewing
 * and resending. The shell shows one explanation with Builder's reason, and the queries
 * stop being resent until the user asks.
 */
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Layout } from "@/app/Layout";
import { resetAdminCheck } from "@/features/admin/store";
import { DatasetCatalogPage } from "@/pages/DatasetCatalogPage";
import { API_BASE } from "@/shared/config/env";
import { useUIStore } from "@/shared/hooks/useUIStore";
import { i18n } from "@/shared/i18n";
import { resetAuthRenewalForTests, setAuthErrorCallback, setAuthTokenProvider } from "@/shared/lib/builderApi";
import { clearSessionRefusal, useSessionRefusalStore } from "@/shared/lib/sessionRefusal";

import { mswServer } from "../vitest.setup";

function renderTables() {
  return render(
    <MemoryRouter initialEntries={["/tables"]}>
      <Routes>
        <Route element={<Layout />}>
          <Route element={<DatasetCatalogPage />} path="tables" />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

let requests: number;
let renewals: number;

function builderAnswers(status: number, body: Record<string, unknown>) {
  mswServer.use(
    http.all(`${API_BASE}/*`, () => {
      requests += 1;
      return HttpResponse.json(body, { status });
    }),
  );
}

beforeEach(() => {
  vi.stubEnv("VITE_USE_REAL_BUILDER", "true");
  act(() => useUIStore.setState({ theme: "light", isMobileSidebarOpen: false, isAssistantDrawerOpen: false }));
  resetAdminCheck();
  clearSessionRefusal();
  resetAuthRenewalForTests();
  requests = 0;
  renewals = 0;
  setAuthTokenProvider(() => "token");
  setAuthErrorCallback(() => {
    renewals += 1;
    return true;
  });
});

afterEach(() => {
  setAuthErrorCallback(null);
  setAuthTokenProvider(null);
  clearSessionRefusal();
  vi.unstubAllEnvs();
});

describe("a session Builder refuses after renewal (#771)", () => {
  it("shows one explanation with Builder's reason instead of each page's error", async () => {
    builderAnswers(401, { error: "email not verified", code: "unauthorized" });
    renderTables();

    expect(await screen.findByRole("heading", { name: i18n.t("sessionRefused.title") })).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("email not verified");
    expect(screen.queryByText(i18n.t("catalog.errors.listTitle"))).not.toBeInTheDocument();
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
  });

  it("renews once and then stops asking Builder", async () => {
    builderAnswers(401, { error: "email not verified", code: "unauthorized" });
    renderTables();
    await screen.findByRole("heading", { name: i18n.t("sessionRefused.title") });
    await new Promise((resolve) => setTimeout(resolve, 100));
    const settled = requests;

    await new Promise((resolve) => setTimeout(resolve, 300));

    // The token was renewed once for the whole screen, and nothing is still being sent.
    expect(renewals).toBe(1);
    expect(requests).toBe(settled);
  });

  it("asks again when the user does, and shows the page once Builder accepts", async () => {
    builderAnswers(401, { error: "email not verified", code: "unauthorized" });
    renderTables();
    await screen.findByRole("heading", { name: i18n.t("sessionRefused.title") });

    mswServer.use(http.all(`${API_BASE}/*`, () => HttpResponse.json({ datasets: [], tables: [], builds: [] })));
    fireEvent.click(screen.getByRole("button", { name: i18n.t("sessionRefused.tryAgain") }));

    await waitFor(() => expect(screen.queryByRole("heading", { name: i18n.t("sessionRefused.title") })).not.toBeInTheDocument());
    expect(useSessionRefusalStore.getState().refusal).toBeNull();
  });

  it("an expired token that renews and is accepted shows the page as before", async () => {
    let first = true;
    mswServer.use(
      http.all(`${API_BASE}/*`, () => {
        if (first) {
          first = false;
          return HttpResponse.json({ error: "token expired", code: "token_expired" }, { status: 401 });
        }
        return HttpResponse.json({ datasets: [], tables: [], builds: [] });
      }),
    );
    renderTables();

    await waitFor(() => expect(renewals).toBe(1));
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(screen.queryByRole("heading", { name: i18n.t("sessionRefused.title") })).not.toBeInTheDocument();
    expect(useSessionRefusalStore.getState().refusal).toBeNull();
  });
});
