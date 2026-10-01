/**
 * A sign-up the Builder ledger holds back is explained once, not as every page's error (#658).
 *
 * Builder contract v1.54.0 (#785): a pending user's every authenticated request answers
 * 403 `signup_pending`, a rejected user's 403 `signup_rejected`. Without the shell knowing
 * these codes, Tables (and every other screen) showed its own generic "could not load".
 * A 403 without these codes, and a user the ledger has approved, keep today's behaviour.
 */
import { act, fireEvent, render, screen } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Layout } from "@/app/Layout";
import { resetAdminCheck } from "@/features/admin/store";
import { DatasetCatalogPage } from "@/pages/DatasetCatalogPage";
import { API_BASE } from "@/shared/config/env";
import { useUIStore } from "@/shared/hooks/useUIStore";
import { i18n } from "@/shared/i18n";
import { clearSignupBlock, signupBlockFrom, useSignupStatusStore } from "@/shared/lib/signupStatus";

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

/** Every Builder route answers the same thing — as the ledger does for a held-back user. */
function builderAnswers(status: number, body: Record<string, unknown>) {
  mswServer.use(http.all(`${API_BASE}/*`, () => HttpResponse.json(body, { status })));
}

const listError = () => i18n.t("catalog.errors.listTitle");

beforeEach(() => {
  vi.stubEnv("VITE_USE_REAL_BUILDER", "true");
  act(() => useUIStore.setState({ theme: "light", isMobileSidebarOpen: false, isAssistantDrawerOpen: false }));
  resetAdminCheck();
  clearSignupBlock();
});

afterEach(() => {
  vi.unstubAllEnvs();
  clearSignupBlock();
});

describe("sign-up ledger refusals (#658)", () => {
  it("shows one pending explanation instead of the page's generic error", async () => {
    builderAnswers(403, { error: "signup pending approval", code: "signup_pending" });
    renderTables();

    expect(await screen.findByRole("heading", { name: i18n.t("signupStatus.pending.title") })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(i18n.t("signupStatus.pending.desc"));
    expect(screen.queryByText(listError())).not.toBeInTheDocument();
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
  });

  it("tells a rejected sign-up apart from a pending one", async () => {
    builderAnswers(403, { error: "signup rejected", code: "signup_rejected" });
    renderTables();

    expect(await screen.findByRole("heading", { name: i18n.t("signupStatus.rejected.title") })).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(i18n.t("signupStatus.rejected.desc"));
    expect(screen.queryByText(i18n.t("signupStatus.pending.title"))).not.toBeInTheDocument();
    expect(screen.queryByText(listError())).not.toBeInTheDocument();
  });

  it("keeps a 403 without a sign-up code as the page's own error", async () => {
    builderAnswers(403, { error: "forbidden" });
    renderTables();

    expect(await screen.findByText(listError())).toBeInTheDocument();
    expect(useSignupStatusStore.getState().block).toBeNull();
    expect(screen.queryByText(i18n.t("signupStatus.pending.title"))).not.toBeInTheDocument();
  });

  it("leaves an approved user's pages alone", async () => {
    builderAnswers(200, { datasets: [], total: 0, tables: [] });
    renderTables();

    expect(await screen.findByText(i18n.t("catalog.empty.title"))).toBeInTheDocument();
    expect(useSignupStatusStore.getState().block).toBeNull();
    expect(screen.queryByText(i18n.t("signupStatus.pending.title"))).not.toBeInTheDocument();
  });

  it("asks again on Check again, and shows the page once the user is approved", async () => {
    builderAnswers(403, { error: "signup pending approval", code: "signup_pending" });
    renderTables();
    const checkAgain = await screen.findByRole("button", { name: i18n.t("signupStatus.checkAgain") });

    builderAnswers(200, { datasets: [], total: 0, tables: [] });
    fireEvent.click(checkAgain);

    expect(await screen.findByText(i18n.t("catalog.empty.title"))).toBeInTheDocument();
    expect(screen.queryByText(i18n.t("signupStatus.pending.title"))).not.toBeInTheDocument();
  });
});

describe("signupBlockFrom", () => {
  it("reads only the two ledger codes on a 403", () => {
    expect(signupBlockFrom(403, { error: "x", code: "signup_pending" })).toBe("pending");
    expect(signupBlockFrom(403, { error: "x", code: "signup_rejected" })).toBe("rejected");
    expect(signupBlockFrom(403, { error: "x", code: "redistribution_forbidden" })).toBeNull();
    expect(signupBlockFrom(403, { error: "x" })).toBeNull();
    expect(signupBlockFrom(401, { error: "x", code: "signup_pending" })).toBeNull();
    expect(signupBlockFrom(403, undefined)).toBeNull();
  });
});
