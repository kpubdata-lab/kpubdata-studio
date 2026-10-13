// @vitest-environment jsdom
/**
 * A refresh that cannot reach the identity provider is not a refused session (#983).
 *
 * keycloak-js rejects `updateToken()` for both: a network error, a timeout or a 5xx from
 * the token endpoint leaves the session as it was, while a refused refresh token (400,
 * `invalid_grant`) ends it. Only the second may sign the user out; the first keeps the
 * identity and the owner-scoped state, retries a bounded number of times, never hands a
 * stale token to a request, and is shown as a notice rather than a sign-out.
 */
import { act, createElement } from "react";
import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockKeycloak, KeycloakCtor } = vi.hoisted(() => {
  const mk = {
    authenticated: false as boolean,
    token: undefined as string | undefined,
    tokenParsed: undefined as unknown,
    init: vi.fn(),
    updateToken: vi.fn(),
    login: vi.fn(),
    logout: vi.fn(),
    onAuthSuccess: undefined as undefined | (() => void),
    onAuthRefreshSuccess: undefined as undefined | (() => void),
    onAuthLogout: undefined as undefined | (() => void),
    onTokenExpired: undefined as undefined | (() => void),
  };
  return { mockKeycloak: mk, KeycloakCtor: vi.fn(function () { return mk; }) };
});

vi.mock("keycloak-js", () => ({ default: KeycloakCtor }));

const wiring = vi.hoisted(() => ({
  authError: undefined as undefined | (() => void | boolean | Promise<void | boolean>),
  tokenProvider: undefined as undefined | (() => string | null | Promise<string | null>),
}));

vi.mock("@/shared/lib/builderApi", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/shared/lib/builderApi")>();
  return {
    ...actual,
    setAuthErrorCallback: (cb: typeof wiring.authError) => {
      wiring.authError = cb;
    },
    setAuthTokenProvider: (provider: typeof wiring.tokenProvider) => {
      wiring.tokenProvider = provider;
    },
  };
});

import { __resetKeycloakForTests, getFreshToken } from "@/features/auth/keycloak";
import { initAuth } from "@/features/auth/init";
import { IdentityProviderUnreachableNotice } from "@/features/auth/IdentityProviderUnreachableNotice";
import { useAuthStore } from "@/features/auth/store";
import { i18n } from "@/shared/i18n";

/** What keycloak-js throws for a non-2xx answer from the token endpoint. */
function httpRefusal(status: number): Error {
  return Object.assign(new Error("Server responded with an invalid status."), {
    response: new Response(null, { status }),
  });
}

/** What `fetch` throws when the identity provider cannot be reached at all. */
function networkFailure(): Error {
  return new TypeError("Failed to fetch");
}

const IDENTITY = {
  email: "user@example.com",
  name: "User",
  userId: "sub-1",
  issuer: "http://localhost:8080/realms/kpubdata",
  emailVerified: true,
};

async function signedIn(): Promise<void> {
  mockKeycloak.authenticated = true;
  mockKeycloak.token = "expired-access-token";
  mockKeycloak.tokenParsed = {
    sub: IDENTITY.userId,
    iss: IDENTITY.issuer,
    email: IDENTITY.email,
    email_verified: true,
    name: IDENTITY.name,
  };
  mockKeycloak.init.mockResolvedValue(true);
  initAuth();
  await vi.waitFor(() => expect(useAuthStore.getState().oidcStatus).toBe("authenticated"));
}

/** Run a promise to completion while the backoff timers are faked. */
async function settle<T>(promise: Promise<T>): Promise<T> {
  await vi.runAllTimersAsync();
  return promise;
}

beforeEach(() => {
  vi.stubEnv("VITE_USE_REAL_BUILDER", "true");
  vi.stubEnv("VITE_OIDC_ISSUER", "http://localhost:8080/realms/kpubdata");
  vi.stubEnv("VITE_OIDC_CLIENT_ID", "kpubdata-studio");
  vi.stubEnv("VITE_DEV_BYPASS_AUTH", "false");

  KeycloakCtor.mockClear();
  mockKeycloak.authenticated = false;
  mockKeycloak.token = undefined;
  mockKeycloak.tokenParsed = undefined;
  mockKeycloak.init.mockReset().mockResolvedValue(false);
  mockKeycloak.updateToken.mockReset().mockResolvedValue(true);
  mockKeycloak.onAuthLogout = undefined;
  __resetKeycloakForTests();
  wiring.authError = undefined;
  wiring.tokenProvider = undefined;
  useAuthStore.getState().clear();
  useAuthStore.setState({ oidcStatus: "disabled", identityProviderUnreachable: false });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  __resetKeycloakForTests();
});

describe("a transient failure at the token endpoint keeps the session (#983)", () => {
  it.each([
    ["a network error", networkFailure],
    ["a 503 from the token endpoint", () => httpRefusal(503)],
    ["a 502 from the token endpoint", () => httpRefusal(502)],
  ])("%s during 401 recovery does not sign the user out", async (_label, failure) => {
    await signedIn();
    vi.useFakeTimers();
    mockKeycloak.updateToken.mockRejectedValue(failure());

    const renewed = await settle(Promise.resolve(wiring.authError?.()));

    // The request is not resent (no token to send), but nobody was signed out.
    expect(renewed).toBe(false);
    const state = useAuthStore.getState();
    expect(state.oidcStatus).toBe("authenticated");
    expect(state).toMatchObject(IDENTITY);
    expect(state.providerId).toBe("keycloak");
    // The non-destructive state the shell shows.
    expect(state.identityProviderUnreachable).toBe(true);
  });

  it("retries a bounded number of times, then stops", async () => {
    await signedIn();
    vi.useFakeTimers();
    mockKeycloak.updateToken.mockRejectedValue(networkFailure());

    await settle(Promise.resolve(wiring.authError?.()));
    const attempts = mockKeycloak.updateToken.mock.calls.length;
    expect(attempts).toBeGreaterThan(1);
    expect(attempts).toBeLessThanOrEqual(3);
  });

  it("does not start another retry series for the next refused request of the same outage", async () => {
    await signedIn();
    vi.useFakeTimers();
    mockKeycloak.updateToken.mockRejectedValue(networkFailure());

    await settle(Promise.resolve(wiring.authError?.()));
    const firstSeries = mockKeycloak.updateToken.mock.calls.length;
    // The next request on the screen is refused too, a moment later.
    await expect(settle(Promise.resolve(wiring.authError?.()))).resolves.toBe(false);
    expect(mockKeycloak.updateToken).toHaveBeenCalledTimes(firstSeries);
    expect(useAuthStore.getState()).toMatchObject({ ...IDENTITY, identityProviderUnreachable: true });

    // Once the cool-down is over, the provider is asked again.
    vi.advanceTimersByTime(5_000);
    mockKeycloak.updateToken.mockReset().mockImplementation(async () => {
      mockKeycloak.token = "renewed";
      return true;
    });
    await expect(settle(Promise.resolve(wiring.authError?.()))).resolves.toBe(true);
    expect(useAuthStore.getState().identityProviderUnreachable).toBe(false);
  });

  it("a timeout at the token endpoint is transient too", async () => {
    await signedIn();
    vi.useFakeTimers();
    mockKeycloak.updateToken.mockImplementation(() => new Promise<boolean>(() => {}));

    const renewed = await settle(Promise.resolve(wiring.authError?.()));
    expect(renewed).toBe(false);
    expect(useAuthStore.getState()).toMatchObject({ ...IDENTITY, oidcStatus: "authenticated" });
    expect(useAuthStore.getState().identityProviderUnreachable).toBe(true);
  });

  it("recovers on a retry and resends the request with the renewed token", async () => {
    await signedIn();
    vi.useFakeTimers();
    mockKeycloak.updateToken
      .mockRejectedValueOnce(networkFailure())
      .mockImplementationOnce(async () => {
        mockKeycloak.token = "renewed";
        return true;
      });

    const renewed = await settle(Promise.resolve(wiring.authError?.()));
    expect(renewed).toBe(true);
    expect(useAuthStore.getState().identityProviderUnreachable).toBe(false);
  });

  it("clears the notice once a later refresh succeeds", async () => {
    await signedIn();
    vi.useFakeTimers();
    mockKeycloak.updateToken.mockRejectedValue(networkFailure());
    await settle(Promise.resolve(wiring.authError?.()));
    expect(useAuthStore.getState().identityProviderUnreachable).toBe(true);

    mockKeycloak.updateToken.mockReset().mockImplementation(async () => {
      mockKeycloak.token = "renewed";
      return true;
    });
    await expect(settle(Promise.resolve(wiring.tokenProvider?.()))).resolves.toBe("renewed");
    expect(useAuthStore.getState().identityProviderUnreachable).toBe(false);
  });

  it("never hands a stale bearer token to a request while the provider is unreachable", async () => {
    await signedIn();
    vi.useFakeTimers();
    mockKeycloak.updateToken.mockRejectedValue(networkFailure());

    await expect(settle(Promise.resolve(wiring.tokenProvider?.()))).resolves.toBeNull();
    await expect(settle(getFreshToken({ force: true }))).resolves.toBeNull();
    expect(useAuthStore.getState()).toMatchObject({ ...IDENTITY, oidcStatus: "authenticated" });
  });
});

describe("a definitive refusal still signs the user out (#983)", () => {
  it("invalid_grant (400): keycloak-js ends the session and the store is cleared, without retrying", async () => {
    await signedIn();
    mockKeycloak.updateToken.mockImplementation(async () => {
      // keycloak-js clears the tokens on a 400 and fires onAuthLogout.
      mockKeycloak.authenticated = false;
      mockKeycloak.token = undefined;
      mockKeycloak.onAuthLogout?.();
      throw httpRefusal(400);
    });

    await expect(wiring.authError?.()).resolves.toBe(false);
    expect(mockKeycloak.updateToken).toHaveBeenCalledTimes(1);
    const state = useAuthStore.getState();
    expect(state.oidcStatus).toBe("unauthenticated");
    expect(state.email).toBeNull();
    expect(state.userId).toBeNull();
    expect(state.identityProviderUnreachable).toBe(false);
  });

  it("a 401 from the token endpoint signs the user out without retrying", async () => {
    await signedIn();
    mockKeycloak.updateToken.mockRejectedValue(httpRefusal(401));

    await expect(wiring.authError?.()).resolves.toBe(false);
    expect(mockKeycloak.updateToken).toHaveBeenCalledTimes(1);
    expect(useAuthStore.getState().oidcStatus).toBe("unauthenticated");
    expect(useAuthStore.getState().userId).toBeNull();
  });

  it("an explicit Keycloak logout still clears the session", async () => {
    await signedIn();
    useAuthStore.setState({ identityProviderUnreachable: true });
    mockKeycloak.onAuthLogout?.();
    expect(useAuthStore.getState()).toMatchObject({
      oidcStatus: "unauthenticated",
      email: null,
      userId: null,
      identityProviderUnreachable: false,
    });
  });
});

describe("the shell says the identity provider is unreachable without signing out (#983)", () => {
  it("shows a status notice only while the last refresh could not reach the provider", () => {
    const view = render(createElement(IdentityProviderUnreachableNotice));
    expect(screen.queryByRole("status")).toBeNull();

    act(() => useAuthStore.getState().setIdentityProviderUnreachable(true));
    expect(screen.getByRole("status").textContent).toBe(i18n.t("auth.idpUnreachable"));

    act(() => useAuthStore.getState().setIdentityProviderUnreachable(false));
    expect(screen.queryByRole("status")).toBeNull();
    view.unmount();
  });
});
