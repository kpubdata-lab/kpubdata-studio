/**
 * Administration page card states (#606).
 *
 * Each card — Policy, All runs, Users — says its own state for every endpoint answer:
 * - 200 shows the data, and an empty list says it is empty (not the same as unsupported)
 * - 404 says this Builder has no such route, per card, never a bare card
 * - a 403 with no card answered is the page-level "not an administrator"; a 403 next to an
 *   answered card stays on its own card
 * - 5xx is an alert on its card
 * - one route failing never hides another card's content
 */
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AdminPage } from "@/pages/AdminPage";
import { i18n } from "@/shared/i18n";
import {
  ApiError,
  builderApi,
  isRealBuilderEnabled,
  type AdminConfigResponse,
  type AdminRunsResponse,
  type AdminUsersResponse,
} from "@/shared/lib/builderApi";

vi.mock("@/shared/lib/builderApi", async () => {
  const actual = await vi.importActual<typeof import("@/shared/lib/builderApi")>("@/shared/lib/builderApi");
  return {
    ...actual,
    isRealBuilderEnabled: vi.fn(() => true),
    builderApi: {
      adminConfig: vi.fn(),
      adminRuns: vi.fn(),
      adminUsers: vi.fn(),
    },
  };
});

const CONFIG: AdminConfigResponse = { enforce_ownership: true, publish_server_credential_fallback: false };
const RUNS: AdminRunsResponse = {
  runs: [{ run_id: "run-alpha", status: "succeeded", started_at: null, finished_at: null, owner_id: "owner-hash-0001" }],
  count: 1,
};
const USERS: AdminUsersResponse = {
  users: [
    {
      user_id: "user-hash-0001",
      display_name: "someone@example.test",
      status: "pending",
      first_seen_at: "2026-09-01T00:00:00+00:00",
      last_seen_at: "2026-09-02T00:00:00+00:00",
      decided_at: null,
      decided_by: null,
    },
  ],
  count: 1,
};

type Answer<T> = T | number;

function answer<T>(mock: { mockResolvedValue: (v: T) => unknown; mockRejectedValue: (e: unknown) => unknown }, value: Answer<T>) {
  if (typeof value === "number") mock.mockRejectedValue(new ApiError(value, `HTTP ${value} from Builder`));
  else mock.mockResolvedValue(value);
}

function renderAdmin({
  config = CONFIG,
  runs = RUNS,
  users = USERS,
}: { config?: Answer<AdminConfigResponse>; runs?: Answer<AdminRunsResponse>; users?: Answer<AdminUsersResponse> } = {}) {
  answer(vi.mocked(builderApi.adminConfig), config);
  answer(vi.mocked(builderApi.adminRuns), runs);
  answer(vi.mocked(builderApi.adminUsers), users);
  return render(
    <MemoryRouter>
      <AdminPage />
    </MemoryRouter>,
  );
}

const t = (key: string, options?: Record<string, unknown>) => i18n.t(key, options);

/**
 * The card (a direct child of the page root) whose heading is the translation of `titleKey`.
 * The page root is the render container's only child; the app shell owns `<main>` (#660).
 */
function card(titleKey: string): HTMLElement {
  let node: HTMLElement | null = screen.getByRole("heading", { name: t(titleKey) });
  while (node && node.parentElement?.parentElement?.parentElement !== document.body) node = node.parentElement;
  if (!node) throw new Error(`no card for ${titleKey}`);
  return node;
}

async function settled() {
  // Every card leaves its skeleton once its request settles.
  await screen.findByRole("heading", { name: t("admin.policyTitle") });
  await vi.waitFor(() => expect(document.querySelector(".animate-pulse")).toBeNull());
}

function loadState(titleKey: string): string | null {
  return card(titleKey).querySelector("[data-load]")?.getAttribute("data-load") ?? null;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(isRealBuilderEnabled).mockReturnValue(true);
});

describe("AdminPage card states (#606)", () => {
  it("shows each card's data when every route answers 200", async () => {
    renderAdmin();
    await settled();
    expect(within(card("admin.policyTitle")).getByText("ENFORCE_OWNERSHIP")).toBeInTheDocument();
    expect(within(card("admin.runsTitle")).getByText("run-alpha")).toBeInTheDocument();
    expect(within(card("admin.users.title")).getByText("someone@example.test")).toBeInTheDocument();
    expect(screen.queryByText(t("admin.forbiddenTitle"))).not.toBeInTheDocument();
  });

  it.each([
    ["admin.policyTitle", { config: 404 }, "admin.policyUnsupported"],
    ["admin.runsTitle", { runs: 404 }, "admin.runsUnsupported"],
    ["admin.users.title", { users: 404 }, "admin.users.unsupported"],
  ] as const)("says %s is unsupported on a 404, and keeps the other cards", async (titleKey, answers, messageKey) => {
    renderAdmin(answers);
    await settled();
    expect(within(card(titleKey)).getByText(t(messageKey))).toBeInTheDocument();
    expect(loadState(titleKey)).toBe("unsupported");
    if (titleKey !== "admin.policyTitle") expect(within(card("admin.policyTitle")).getByText("ENFORCE_OWNERSHIP")).toBeInTheDocument();
    if (titleKey !== "admin.runsTitle") expect(within(card("admin.runsTitle")).getByText("run-alpha")).toBeInTheDocument();
    if (titleKey !== "admin.users.title") expect(within(card("admin.users.title")).getByText("someone@example.test")).toBeInTheDocument();
  });

  it("gives every card its own message when every route is 404", async () => {
    renderAdmin({ config: 404, runs: 404, users: 404 });
    await settled();
    expect(within(card("admin.policyTitle")).getByText(t("admin.policyUnsupported"))).toBeInTheDocument();
    expect(within(card("admin.runsTitle")).getByText(t("admin.runsUnsupported"))).toBeInTheDocument();
    expect(within(card("admin.users.title")).getByText(t("admin.users.unsupported"))).toBeInTheDocument();
  });

  it("tells an empty run list apart from an unsupported one", async () => {
    renderAdmin({ runs: { runs: [], count: 0 } });
    await settled();
    const runs = card("admin.runsTitle");
    expect(within(runs).getByText(t("admin.runsEmpty"))).toBeInTheDocument();
    expect(loadState("admin.runsTitle")).toBe("empty");
    expect(within(runs).queryByText(t("admin.runsUnsupported"))).not.toBeInTheDocument();
    expect(within(runs).queryByRole("table")).not.toBeInTheDocument();
  });

  it("keeps the page-level administrator notice when every route is 403", async () => {
    renderAdmin({ config: 403, runs: 403, users: 403 });
    expect(await screen.findByText(t("admin.forbiddenTitle"))).toBeInTheDocument();
    expect(screen.getByText(t("admin.forbiddenBody"))).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: t("admin.policyTitle") })).not.toBeInTheDocument();
  });

  it("keeps the cards Builder answered when only one route is 403", async () => {
    renderAdmin({ runs: 403 });
    await settled();
    expect(screen.queryByText(t("admin.forbiddenTitle"))).not.toBeInTheDocument();
    expect(within(card("admin.runsTitle")).getByText(t("admin.cardForbidden"))).toBeInTheDocument();
    expect(within(card("admin.policyTitle")).getByText("ENFORCE_OWNERSHIP")).toBeInTheDocument();
    expect(within(card("admin.users.title")).getByText("someone@example.test")).toBeInTheDocument();
  });

  it.each([
    ["admin.policyTitle", { config: 500 }],
    ["admin.runsTitle", { runs: 502 }],
    ["admin.users.title", { users: 503 }],
  ] as const)("shows a 5xx on %s as an alert on that card", async (titleKey, answers) => {
    renderAdmin(answers);
    await settled();
    const alert = within(card(titleKey)).getByRole("alert");
    expect(alert).toHaveTextContent(/HTTP 5\d\d from Builder/);
    expect(loadState(titleKey)).toBe("error");
  });

  it("shows the card messages in English too", async () => {
    await i18n.changeLanguage("en");
    try {
      renderAdmin({ config: 404, runs: { runs: [], count: 0 } });
      await settled();
      expect(within(card("admin.policyTitle")).getByText(/has no GET \/admin\/config \(404\)/)).toBeInTheDocument();
      expect(within(card("admin.runsTitle")).getByText("KPubData Builder has recorded no runs yet.")).toBeInTheDocument();
    } finally {
      await i18n.changeLanguage("ko");
    }
  });
});
