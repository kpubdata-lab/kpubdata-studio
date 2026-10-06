/**
 * Signing out of an OIDC session clears this browser before the page leaves (#769).
 *
 * keycloak-js's `logout()` only navigates away. Nothing cleared the session first, so the
 * assistant's saved LLM key stayed in `localStorage` on a shared machine. These record
 * what the browser still holds at the moment `keycloakLogout` is called — the last
 * moment anything can run.
 */
import { execFileSync } from "node:child_process";

import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AccountMenu } from "@/app/AccountMenu";
import { Layout } from "@/app/Layout";
import { useAssistConfig } from "@/features/assistant/config";
import { signOutOfOidc } from "@/features/auth/signOut";
import { useAuthStore } from "@/features/auth/store";
import { SettingsPage } from "@/pages/SettingsPage";
import { useUIStore } from "@/shared/hooks/useUIStore";
import { i18n } from "@/shared/i18n";
import { holdProviderKey, isProviderKeyHeld } from "@/shared/lib/providerKeys";
import { clearSessionRefusal, useSessionRefusalStore } from "@/shared/lib/sessionRefusal";

const ISSUER = "https://id.example/realms/kpubdata";
const SAVED_KEY = `kpubdata-assist-key:sub:${ISSUER}#alice`;

interface AtLogout {
  savedKey: string | null;
  memoryKey: string;
  userId: string | null;
  providerKeyHeld: boolean;
}

const atLogout: AtLogout[] = [];

vi.mock("@/features/auth/keycloak", () => ({
  keycloakLogout: vi.fn(async () => {
    atLogout.push({
      savedKey: localStorage.getItem(SAVED_KEY),
      memoryKey: useAssistConfig.getState().apiKey,
      userId: useAuthStore.getState().userId,
      providerKeyHeld: isProviderKeyHeld("datago"),
    });
  }),
}));

beforeEach(() => {
  atLogout.length = 0;
  localStorage.clear();
  vi.spyOn(window, "confirm").mockReturnValue(true);
  useAuthStore.getState().setOidcIdentity({
    email: "alice@example.com",
    name: "Alice",
    userId: "alice",
    issuer: ISSUER,
    emailVerified: true,
  });
  useAuthStore.getState().setOidcStatus("authenticated");
  useAssistConfig.getState().setConfig({ apiKey: "sk-alice" });
  useAssistConfig.getState().enablePersistence();
  expect(holdProviderKey("datago", "placeholder-provider-key")).toBe(true);
  // The key is where the bug left it: saved under the signed-in user.
  expect(localStorage.getItem(SAVED_KEY)).toBe("sk-alice");
});

afterEach(() => {
  clearSessionRefusal();
  useAuthStore.getState().clear();
  useAuthStore.getState().setOidcStatus("unauthenticated");
  useAssistConfig.setState({ apiKey: "", isConfigured: false, persistToStorage: false });
  localStorage.clear();
  vi.restoreAllMocks();
});

function expectClearedBeforeLeaving() {
  expect(atLogout).toEqual([{ savedKey: null, memoryKey: "", userId: null, providerKeyHeld: false }]);
}

describe("OIDC sign-out clears the browser before leaving (#769)", () => {
  it("signOutOfOidc clears the saved LLM key, the session and the held keys first", async () => {
    await signOutOfOidc();

    expectClearedBeforeLeaving();
  });

  it("the account menu signs out through it", async () => {
    render(
      <MemoryRouter>
        <AccountMenu />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole("button", { expanded: false }));
    fireEvent.click(await screen.findByRole("button", { name: "로그아웃" }));

    await waitFor(() => expect(atLogout).toHaveLength(1));
    expectClearedBeforeLeaving();
  });

  it("the settings page signs out through it", async () => {
    render(
      <MemoryRouter>
        <SettingsPage />
      </MemoryRouter>,
    );

    fireEvent.click(await screen.findByRole("button", { name: "로그아웃" }));

    await waitFor(() => expect(atLogout).toHaveLength(1));
    expectClearedBeforeLeaving();
  });

  it("a session that is not OIDC is cleared here and goes nowhere", async () => {
    useAuthStore.getState().setOidcStatus("unauthenticated");
    render(
      <MemoryRouter>
        <AccountMenu />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole("button", { expanded: false }));
    fireEvent.click(await screen.findByRole("button", { name: "로그아웃" }));

    await waitFor(() => expect(useAuthStore.getState().userId).toBeNull());
    expect(atLogout).toEqual([]);
    expect(localStorage.getItem(SAVED_KEY)).toBeNull();
  });

  it("the notice for a session Builder refuses signs out through it (#771)", async () => {
    // jsdom has no matchMedia, so pin the theme to avoid the system branch.
    act(() => useUIStore.setState({ theme: "light", isMobileSidebarOpen: false, isAssistantDrawerOpen: false }));
    render(
      <MemoryRouter>
        <Routes>
          <Route element={<Layout />}>
            <Route element={<p>page</p>} path="*" />
          </Route>
        </Routes>
      </MemoryRouter>,
    );
    // The refusal arrives after the shell is up, as it does when a query is refused.
    act(() => useSessionRefusalStore.setState({ refusal: { code: "unauthorized", reason: "email not verified" } }));

    const notice = await screen.findByRole("alert");
    fireEvent.click(within(notice).getByRole("button", { name: i18n.t("sessionRefused.signOut") }));

    await waitFor(() => expect(atLogout).toHaveLength(1));
    expectClearedBeforeLeaving();
  });
});

describe("there is one way out of an OIDC session (#769)", () => {
  it("only signOut.ts calls keycloakLogout", () => {
    const callers = execFileSync("git", ["grep", "-l", "keycloakLogout", "--", "src"], { encoding: "utf8" })
      .split("\n")
      .filter((file) => file && !/\.test\.tsx?$/.test(file))
      .sort();

    // The definition, and the one caller that clears the session first. A new caller
    // would leave the saved LLM key behind, as the two before it did.
    expect(callers).toEqual(["src/features/auth/keycloak.ts", "src/features/auth/signOut.ts"]);
  });
});
