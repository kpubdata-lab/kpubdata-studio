/**
 * Signing out of an OIDC session clears this browser before the page leaves (#769).
 *
 * keycloak-js's `logout()` only navigates away. Nothing cleared the session first, so the
 * assistant's saved LLM key stayed in `localStorage` on a shared machine. These record
 * what the browser still holds at the moment `keycloakLogout` is called — the last
 * moment anything can run.
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AccountMenu } from "@/app/AccountMenu";
import { useAssistConfig } from "@/features/assistant/config";
import { signOutOfOidc } from "@/features/auth/signOut";
import { useAuthStore } from "@/features/auth/store";
import { SettingsPage } from "@/pages/SettingsPage";
import { holdProviderKey, isProviderKeyHeld } from "@/shared/lib/providerKeys";

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
});
