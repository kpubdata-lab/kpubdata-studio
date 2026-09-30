/**
 * Administration (#409): the menu follows the Builder's answer, the page shows the
 * Builder's 403 rather than relying on being hidden, and no credential reaches the screen.
 */
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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

  it("does not appear when the Builder answers 403", async () => {
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

describe("administration menu after a failed check (#480)", () => {
  it("asks again on the next navigation instead of staying hidden until reload", async () => {
    let engineUp = false;
    mswServer.use(
      http.get(`${API_BASE}/admin/config`, () =>
        engineUp ? HttpResponse.json(CONFIG) : HttpResponse.json({ error: "down" }, { status: 503 }),
      ),
    );
    renderShell();
    await waitFor(() => expect(useAdminStore.getState().status).toBe("unknown"));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(menu().queryByRole("link", { name: "관리" })).not.toBeInTheDocument();

    engineUp = true;
    fireEvent.click(menu().getByRole("link", { name: "테이블" }));
    expect(await menu().findByRole("link", { name: "관리" })).toBeInTheDocument();
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

  it("shows the Builder's 403 when reached by URL, instead of an empty page", async () => {
    answerConfig(403, { error: "forbidden" });
    mswServer.use(http.get(`${API_BASE}/admin/runs`, () => HttpResponse.json({ error: "forbidden" }, { status: 403 })));
    renderPage();
    expect(await screen.findByRole("alert")).toHaveTextContent("관리자가 아닙니다");
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("never displays a credential, even if an Builder sent one", async () => {
    answerConfig(200, { ...CONFIG, publish_token: "hf_SECRET_VALUE" });
    mswServer.use(http.get(`${API_BASE}/admin/runs`, () => HttpResponse.json(RUNS)));
    renderPage();
    await screen.findByText("run-42");
    expect(document.body.textContent).not.toContain("hf_SECRET_VALUE");
  });
});

describe("users and sign-up approval (#409, builder#785)", () => {
  const PENDING = {
    user_id: "a1b2c3d4e5f60718293a4b5c",
    display_name: "new.person@example.org",
    status: "pending",
    first_seen_at: "2026-09-30T01:00:00Z",
    last_seen_at: "2026-09-30T01:05:00Z",
    decided_at: null,
    decided_by: null,
  };
  const APPROVED = {
    user_id: "f0e1d2c3b4a5968778695a4b",
    display_name: "listed@example.org",
    status: "approved",
    first_seen_at: "2026-09-29T01:00:00Z",
    last_seen_at: "2026-09-30T02:00:00Z",
    decided_at: "2026-09-29T01:00:00Z",
    decided_by: "allowlist",
  };

  function renderPage() {
    return render(
      <MemoryRouter initialEntries={["/admin"]}>
        <Routes>
          <Route element={<AdminPage />} path="/admin" />
        </Routes>
      </MemoryRouter>,
    );
  }

  function answerAdmin(users: Record<string, unknown>) {
    answerConfig(200);
    mswServer.use(
      http.get(`${API_BASE}/admin/runs`, () => HttpResponse.json(RUNS)),
      http.get(`${API_BASE}/admin/users`, () => HttpResponse.json(users as Record<string, never>)),
    );
  }

  function usersTable() {
    return within(screen.getByRole("table", { name: "사용자" }));
  }

  afterEach(() => vi.restoreAllMocks());

  it("lists the ledger: display name, short id hash, status and who decided", async () => {
    answerAdmin({ count: 2, users: [PENDING, APPROVED] });
    renderPage();
    expect(await screen.findByText("new.person@example.org")).toBeInTheDocument();
    const table = usersTable();
    expect(table.getByText("a1b2c3d4e5f6")).toBeInTheDocument();
    expect(table.queryByText(PENDING.user_id)).not.toBeInTheDocument();
    expect(table.getByText("승인 대기").closest("[data-status]")).toHaveAttribute("data-status", "actionable");
    expect(table.getByText("허용 목록")).toBeInTheDocument();
    expect(screen.getByText("승인 대기 1명")).toBeInTheDocument();
  });

  it("approves a pending sign-up only after confirmation, and shows Builder's answer", async () => {
    answerAdmin({ count: 1, users: [PENDING] });
    let approved = 0;
    let approvedId = "";
    mswServer.use(
      http.post(`${API_BASE}/admin/users/:userId/approve`, ({ params }) => {
        approved += 1;
        approvedId = String(params.userId);
        return HttpResponse.json({ ...PENDING, status: "approved", decided_at: "2026-09-30T03:00:00Z", decided_by: "0badc0ffee00112233" });
      }),
    );
    const confirm = vi.spyOn(window, "confirm").mockReturnValueOnce(false).mockReturnValueOnce(true);
    renderPage();
    const approve = await screen.findByRole("button", { name: "new.person@example.org 승인" });

    fireEvent.click(approve);
    expect(confirm).toHaveBeenCalledTimes(1);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(approved).toBe(0);

    fireEvent.click(approve);
    await waitFor(() => expect(approved).toBe(1));
    expect(approvedId).toBe(PENDING.user_id);
    const approvedStatus = await usersTable().findByText("승인됨");
    expect(approvedStatus.closest("[data-status]")).toHaveAttribute("data-status", "normal");
    expect(usersTable().getByText("0badc0ffee00")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "new.person@example.org 승인" })).not.toBeInTheDocument();
  });

  it("rejects a sign-up after confirmation", async () => {
    answerAdmin({ count: 1, users: [PENDING] });
    mswServer.use(
      http.post(`${API_BASE}/admin/users/:userId/reject`, () =>
        HttpResponse.json({ ...PENDING, status: "rejected", decided_at: "2026-09-30T03:00:00Z", decided_by: "0badc0ffee00112233" }),
      ),
    );
    vi.spyOn(window, "confirm").mockReturnValue(true);
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "new.person@example.org 거절" }));
    expect(await usersTable().findByText("거절됨")).toBeInTheDocument();
  });

  it("shows Builder's 403 on a decision instead of pretending it worked", async () => {
    answerAdmin({ count: 1, users: [PENDING] });
    mswServer.use(
      http.post(`${API_BASE}/admin/users/:userId/approve`, () => HttpResponse.json({ error: "forbidden" }, { status: 403 })),
    );
    vi.spyOn(window, "confirm").mockReturnValue(true);
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "new.person@example.org 승인" }));
    expect(await screen.findByText(/KPubData Builder 가 이 결정을 거부했습니다 \(403\)/)).toBeInTheDocument();
    expect(usersTable().getByText("승인 대기")).toBeInTheDocument();
  });

  it("shows Builder's 403 for the user list when reached by a non-administrator", async () => {
    answerConfig(403, { error: "forbidden" });
    mswServer.use(
      http.get(`${API_BASE}/admin/runs`, () => HttpResponse.json({ error: "forbidden" }, { status: 403 })),
      http.get(`${API_BASE}/admin/users`, () => HttpResponse.json({ error: "forbidden" }, { status: 403 })),
    );
    renderPage();
    expect(await screen.findByRole("alert")).toHaveTextContent("관리자가 아닙니다");
    expect(screen.queryByRole("table", { name: "사용자" })).not.toBeInTheDocument();
  });

  it("says when nobody is in the ledger (a deployment without OIDC)", async () => {
    answerAdmin({ count: 0, users: [] });
    renderPage();
    expect(await screen.findByText(/아직 로그인한 OIDC 사용자가 없습니다/)).toBeInTheDocument();
  });

  it("never displays a credential, even if a Builder sent one with a user", async () => {
    answerAdmin({ count: 1, users: [{ ...PENDING, access_token: "eyJ_NOT_A_REAL_TOKEN", id_token: "id_SECRET_VALUE" }] });
    renderPage();
    await screen.findByText("new.person@example.org");
    expect(document.body.textContent).not.toContain("eyJ_NOT_A_REAL_TOKEN");
    expect(document.body.textContent).not.toContain("id_SECRET_VALUE");
  });
});
